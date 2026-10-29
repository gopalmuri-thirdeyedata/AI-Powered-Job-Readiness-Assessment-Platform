"""
Section-specific retests: an administrator assigns ONE section of a finished attempt again; the candidate sits only that section with the
credentials / capability PrepWin already uses (no registration, no new account); and only after a successful evaluation does that
section's effective score change - the other two sections, the registration and the attempt record stay exactly as they were, and the
overall score is recalculated by the existing formula (assessment_policy.overall_score).

Real engine, real sandbox (local subprocess), real login sessions, scratch database. Only the interview model's answer is stubbed.
"""
import copy
import json
import threading
from datetime import timedelta

import pytest

import models
from services import assessment_clock as clock
from services import assessment_flow_service as flow
from services import assessment_policy as policy
from services import retest_service as svc
from tests import local_auth_helpers as lah
from tests import recruitment_helpers as h

client = h.client
BASE = "/api/admin/recruitment"
PUB = "/api/public/retest"
STUDENT_API = "/api/student-assessment"
PASSWORD = "Zx9#pLm2!qWe-4417"
BAD_SOLUTIONS = {pid: {"language": "python", "code": h.program("def solve(*args):\n    return None\n")} for pid in ("C1", "C2")}
SECTIONS = ("aptitude", "coding", "interview")


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
    db.rollback()
    if created:
        sess_ids = [r[0] for r in db.query(models.RoleReadySession.id).filter(models.RoleReadySession.organization_id == a["org"].id)]
        if sess_ids:
            db.query(models.AssessmentReview).filter(models.AssessmentReview.session_id.in_(sess_ids)).delete(synchronize_session=False)
        db.query(models.StudentProfile).filter(models.StudentProfile.user_id.in_(created)).delete(synchronize_session=False)
        db.query(models.AuthSession).filter(models.AuthSession.user_id.in_(created)).delete(synchronize_session=False)
        db.commit()
    h.cleanup_orgs(db, [a["org"].id, b["org"].id])
    if created:
        db.query(models.User).filter(models.User.id.in_(created)).delete(synchronize_session=False)
        db.commit()


@pytest.fixture(autouse=True)
def _setup(monkeypatch):
    h.reset_public_limiters()
    h.install_local_sandbox(monkeypatch)
    h.patch_interview_eval(monkeypatch)
    from routers import student_assessment, public_retest
    student_assessment.access_limiter.reset()
    for lim in (public_retest.info_limiter, public_retest.start_limiter):
        lim.reset()
    lah.reset_login_limits()
    yield
    h.reset_public_limiters()


# ------------------------------------------------------------------------------ helpers
def admin(world, who="a"):
    return h.auth(world[who]["token"])


def complete_accountless(db, world, monkeypatch, *, apt=13, coding_good=False, interview=15.0, name="Retest Candidate"):
    """An accountless candidate whose attempt is COMPLETED with a chosen score per section (default: the 86.7 / 0 / 15 example)."""
    h.patch_interview_eval(monkeypatch, score=interview)
    job = world["job"]
    token, email = h.register_ok(job["share_token"], name=name)
    s = h.start_ok(job["share_token"], token)
    assert client.post(h.sess_url(s, "submit-aptitude"), headers=h.sh(s), json={"answers": h.correct_aptitude_answers(db, s["session_uuid"], apt)}).status_code == 200
    assert client.post(h.sess_url(s, "submit-coding"), headers=h.sh(s), json={"solutions": h.GOOD_SOLUTIONS if coding_good else BAD_SOLUTIONS}).status_code == 200
    r = client.post(h.sess_url(s, "submit-interview"), headers=h.sh(s), json={"answers": {f"I{i}": "my answer" for i in range(1, 6)}})
    assert r.status_code == 200 and r.json()["state"] == "COMPLETED", r.text
    h.reset_public_limiters()
    h.patch_interview_eval(monkeypatch)
    return {"session": s, "registration_token": token, "email": email, "reg_id": reg_id(db, email)}


def reg_id(db, email):
    db.expire_all()
    return db.query(models.CandidateRegistration).filter_by(email=email).first().id


def make_student(db, world, name):
    email = f"{name.lower().replace(' ', '.')}.{h.new_tag()}@rwtest.com"
    user = lah.ensure_user(db, email, models.UserRole.STUDENT.value, org=world["a"]["org"], password=PASSWORD, student_profile=True, full_name=name)
    user.full_name, user.phone = name, "+14155550123"
    db.commit()
    world["created"].append(user.id)
    return user


def signed_in(user):
    c, res = lah.login(user.email, PASSWORD)
    c.headers["X-CSRF-Token"] = res.json()["csrf_token"]
    return c


def complete_student(db, world, monkeypatch, name="Student Retester", **kw):
    user = make_student(db, world, name)
    c = signed_in(user)
    job = world["job"]
    got = c.post(f"{STUDENT_API}/{job['share_token']}/access")
    assert got.status_code == 200 and got.json()["status"] == "READY", got.text
    r = c.post(f"/api/public/assessment/{job['share_token']}/start", headers={"X-Registration-Token": got.json()["registration_token"]}, json={"acknowledged": True})
    assert r.status_code == 200, r.text
    s = r.json()
    h.patch_interview_eval(monkeypatch, score=kw.get("interview", 15.0))
    assert c.post(h.sess_url(s, "submit-aptitude"), headers=h.sh(s), json={"answers": h.correct_aptitude_answers(db, s["session_uuid"], kw.get("apt", 13))}).status_code == 200
    assert c.post(h.sess_url(s, "submit-coding"), headers=h.sh(s), json={"solutions": BAD_SOLUTIONS}).status_code == 200
    assert c.post(h.sess_url(s, "submit-interview"), headers=h.sh(s), json={"answers": {f"I{i}": "x" for i in range(1, 6)}}).json()["state"] == "COMPLETED"
    h.patch_interview_eval(monkeypatch)
    return user, c, s


def assign(world, reg, sections, reason=None, who="a"):
    return client.post(f"{BASE}/candidates/{reg}/retests", headers=admin(world, who), json={"sections": sections, "reason": reason})


def assign_ok(world, reg, sections, **kw):
    r = assign(world, reg, sections, **kw)
    assert r.status_code == 201, r.text
    return r.json()


def sitting_headers(started):
    return {"X-Session-Token": started["session_token"], "X-Session-Lease": started["session_lease"]}


def start_retest(item, c=None, token=True):
    headers = {"X-Retest-Token": item["access_token"]} if token and item.get("access_token") else {}
    r = (c or client).post(f"{PUB}/{item['retest_uuid']}/start", headers=headers, json={"acknowledged": True})
    return r


def start_ok(item, c=None):
    r = start_retest(item, c)
    assert r.status_code == 200, r.text
    return r.json()


def correct_answers(db, retest_uuid, count=None):
    db.expire_all()
    row = db.query(models.AssessmentRetest).filter_by(retest_uuid=retest_uuid).one()
    items = [(qid, info["correct_key"]) for qid, info in row.server_keys_payload.items()]
    return dict(items[:count] if count is not None else items)


def snapshot(db, session_uuid):
    """Everything about the attempt that a retest of ONE section must leave alone, captured for comparison."""
    db.expire_all()
    s = db.query(models.RoleReadySession).filter_by(session_uuid=session_uuid).one()
    rounds = {r.round_type: r for r in db.query(models.RoleReadyRoundAttempt).filter_by(session_id=s.id)}

    def rnd(r):
        return (r.id, r.status, r.score, json.dumps(r.evaluation_payload, sort_keys=True), json.dumps(r.submission_payload, sort_keys=True),
                json.dumps(r.questions_payload, sort_keys=True), json.dumps(r.server_keys_payload, sort_keys=True), r.started_at, r.submitted_at,
                r.evaluated_at, r.time_spent_seconds, json.dumps(r.proctoring_violations, sort_keys=True))

    return {"session_id": s.id, "registration_id": s.registration_id, "state": s.current_state, "uuid": s.session_uuid,
            "scores": {"APTITUDE": s.aptitude_score, "CODING": s.coding_score, "INTERVIEW": s.interview_score},
            "overall": s.overall_readiness_score, "completed_at": s.completed_at, "finalized_at": s.finalized_at,
            "report": copy.deepcopy(s.final_report_data), "rounds": {k: rnd(v) for k, v in rounds.items()}}


def counts(db, world):
    db.expire_all()
    org = world["a"]["org"].id
    return (db.query(models.RoleReadySession).filter_by(organization_id=org).count(),
            db.query(models.CandidateRegistration).filter_by(organization_id=org).count(),
            db.query(models.RoleReadyRoundAttempt).join(models.RoleReadySession, models.RoleReadySession.id == models.RoleReadyRoundAttempt.session_id)
            .filter(models.RoleReadySession.organization_id == org).count())


def roster_row(world, reg):
    items = client.get(f"{BASE}/candidates", headers=admin(world), params={"page_size": 100}).json()["items"]
    rows = [i for i in items if i["id"] == reg]
    assert len(rows) == 1, "the candidate must appear in exactly one results row"
    return rows[0]


def retest_row(db, retest_uuid):
    db.expire_all()
    return db.query(models.AssessmentRetest).filter_by(retest_uuid=retest_uuid).one()


def run_coding_retest(db, item, c=None, solutions=None):
    started = start_ok(item, c)
    r = (c or client).post(f"{PUB}/{item['retest_uuid']}/submit", headers=sitting_headers(started), json={"solutions": solutions or h.GOOD_SOLUTIONS})
    return started, r


def assert_untouched(before, after, *, changed):
    """Everything outside the retested section (and the overall fields) is identical."""
    keep = [s for s in ("APTITUDE", "CODING", "INTERVIEW") if s != changed]
    for s in keep:
        assert after["scores"][s] == before["scores"][s], f"{s} score changed"
        assert after["rounds"][s] == before["rounds"][s], f"{s} round record changed"
        assert after["report"]["sections"][s.lower()] == before["report"]["sections"][s.lower()], f"{s} report entry changed"
    for key in ("session_id", "registration_id", "uuid", "state", "completed_at", "finalized_at"):
        assert after[key] == before[key], key
    assert after["rounds"][changed][0] == before["rounds"][changed][0]       # same round row: updated in place, never recreated


def expected_overall(scores):
    return policy.overall_score(scores["APTITUDE"], scores["CODING"], scores["INTERVIEW"])


# ------------------------------------------------------------------------------ the headline example
def test_coding_retest_changes_only_coding_and_recalculates_overall(db, world, monkeypatch):
    cand = complete_accountless(db, world, monkeypatch)
    uuid, reg = cand["session"]["session_uuid"], cand["reg_id"]
    before = snapshot(db, uuid)
    before_counts = counts(db, world)
    assert round(before["scores"]["APTITUDE"], 1) == 86.7 and before["scores"]["CODING"] == 0.0 and before["scores"]["INTERVIEW"] == 15.0
    row_before = roster_row(world, reg)
    assert (row_before["aptitude_score"], row_before["coding_score"], row_before["interview_score"]) == (86.67, 0.0, 15.0)

    item = assign_ok(world, reg, ["coding"], reason="Sandbox crashed during the attempt")["retests"][0]
    assert item["section"] == "coding" and item["status"] == "ASSIGNED" and item["original_score"] == 0.0
    # assigning alone changes nothing about the result
    assert snapshot(db, uuid) == before

    started, r = run_coding_retest(db, item)
    assert r.status_code == 200, r.text
    after = snapshot(db, uuid)

    assert after["scores"]["CODING"] > 0.0 and after["scores"]["CODING"] != before["scores"]["CODING"]
    assert_untouched(before, after, changed="CODING")
    assert after["overall"] == expected_overall(after["scores"]) != before["overall"]          # existing formula, not a new one
    assert after["report"]["overall_score"] == after["overall"] and after["report"]["sections"]["coding"]["score"] == policy.display_pct(after["scores"]["CODING"])
    assert counts(db, world) == before_counts                                                  # no new attempt / registration / round rows

    row = roster_row(world, reg)                                                               # one row, new effective numbers
    assert row["coding_score"] == policy.display_pct(after["scores"]["CODING"])
    assert (row["aptitude_score"], row["interview_score"]) == (86.67, 15.0) and row["overall_score"] == after["overall"]

    retest = retest_row(db, item["retest_uuid"])
    assert retest.status == "COMPLETED" and retest.active_key is None and retest.completed_at is not None
    assert retest.original_score == 0.0 and retest.retest_score == after["scores"]["CODING"]
    assert retest.previous_snapshot["effective_score"] == 0.0                                  # history keeps the old number, labelled as such


def test_aptitude_retest_changes_only_aptitude(db, world, monkeypatch):
    cand = complete_accountless(db, world, monkeypatch, coding_good=True, apt=5)
    uuid, reg = cand["session"]["session_uuid"], cand["reg_id"]
    before = snapshot(db, uuid)
    item = assign_ok(world, reg, ["aptitude"])["retests"][0]
    started = start_ok(item)
    assert [q["id"] for q in started["state"]["section"]["questions"]] == [q["id"] for q in json.loads(before["rounds"]["APTITUDE"][5])]
    r = client.post(f"{PUB}/{item['retest_uuid']}/submit", headers=sitting_headers(started), json={"answers": correct_answers(db, item["retest_uuid"])})
    assert r.status_code == 200, r.text
    after = snapshot(db, uuid)
    assert after["scores"]["APTITUDE"] == 100.0 and before["scores"]["APTITUDE"] < 100.0
    assert_untouched(before, after, changed="APTITUDE")
    assert after["overall"] == expected_overall(after["scores"])


def test_interview_retest_changes_only_interview(db, world, monkeypatch):
    cand = complete_accountless(db, world, monkeypatch, coding_good=True)
    uuid, reg = cand["session"]["session_uuid"], cand["reg_id"]
    before = snapshot(db, uuid)
    item = assign_ok(world, reg, ["interview"])["retests"][0]
    started = start_ok(item)
    h.patch_interview_eval(monkeypatch, score=70.0)
    r = client.post(f"{PUB}/{item['retest_uuid']}/submit", headers=sitting_headers(started), json={"answers": {f"I{i}": "better answer" for i in range(1, 6)}})
    assert r.status_code == 200, r.text
    after = snapshot(db, uuid)
    assert after["scores"]["INTERVIEW"] == 70.0 and before["scores"]["INTERVIEW"] == 15.0
    assert_untouched(before, after, changed="INTERVIEW")
    assert after["overall"] == expected_overall(after["scores"])


# ------------------------------------------------------------------------------ the dialog and the dossier
def test_dialog_reads_candidate_and_scores_from_the_database_and_dossier_labels_history(db, world, monkeypatch):
    cand = complete_accountless(db, world, monkeypatch, name="Dialog Person")
    reg = cand["reg_id"]
    info = client.get(f"{BASE}/candidates/{reg}/retests", headers=admin(world)).json()
    assert info["candidate"] == {"id": reg, "name": "Dialog Person", "email": cand["email"]}
    assert info["job_role"]["title"] == "Backend Engineer" and info["eligible"] is True and info["attempt_state"] == "COMPLETED"
    assert [(s["key"], s["score"]) for s in info["sections"]] == [("aptitude", 86.67), ("coding", 0.0), ("interview", 15.0)]

    item = assign_ok(world, reg, ["coding", "interview"], reason="  hardware   fault ")["retests"]
    assert len(item) == 2 and {i["section"] for i in item} == {"coding", "interview"}
    info = client.get(f"{BASE}/candidates/{reg}/retests", headers=admin(world)).json()
    open_sections = {s["key"] for s in info["sections"] if s["active_retest"]}
    assert open_sections == {"coding", "interview"} and info["history"][0]["reason"] == "hardware fault"
    assert info["history"][0]["assigned_by"] == world["a"]["user"].email

    coding = next(i for i in item if i["section"] == "coding")
    started, r = run_coding_retest(db, coding)
    assert r.status_code == 200
    dossier = client.get(f"{BASE}/candidates/{reg}/dossier", headers=admin(world)).json()
    new_coding = dossier["report"]["sections"]["coding"]["score"]
    assert new_coding and new_coding > 0 and dossier["report"]["overall_score"] is not None            # the dossier shows the effective result
    done = next(x for x in dossier["retests"] if x["section"] == "coding")
    assert done["status"] == "COMPLETED" and done["original_score"] == 0.0 and done["retest_score"] == new_coding and done["completed_at"]
    assert next(x for x in dossier["retests"] if x["section"] == "interview")["status"] == "ASSIGNED"  # history never overrides the result


def test_a_second_active_retest_for_the_same_section_is_refused_and_cancel_frees_it(db, world, monkeypatch):
    cand = complete_accountless(db, world, monkeypatch)
    reg = cand["reg_id"]
    first = assign_ok(world, reg, ["coding"])["retests"][0]
    dup = assign(world, reg, ["coding", "aptitude"])
    assert dup.status_code == 409 and dup.json()["detail"]["code"] == "RETEST_ALREADY_ACTIVE"
    db.expire_all()
    assert db.query(models.AssessmentRetest).filter_by(registration_id=reg).count() == 1             # nothing half-created
    assert assign(world, reg, []).status_code == 422 and assign(world, reg, ["math"]).status_code == 422
    assert client.post(f"{BASE}/retests/{first['retest_uuid']}/cancel", headers=admin(world)).json()["status"] == "CANCELLED"
    assert start_retest(first).status_code in (404, 409)                                              # a cancelled retest cannot be started
    assert retest_row(db, first['retest_uuid']).status == 'CANCELLED' and retest_row(db, first['retest_uuid']).started_at is None
    assert assign(world, reg, ["coding"]).status_code == 201                                          # the slot is free again


def test_admins_of_other_organizations_cannot_see_assign_or_cancel(db, world, monkeypatch):
    cand = complete_accountless(db, world, monkeypatch)
    reg = cand["reg_id"]
    item = assign_ok(world, reg, ["coding"])["retests"][0]
    assert client.get(f"{BASE}/candidates/{reg}/retests", headers=admin(world, "b")).status_code == 404
    assert assign(world, reg, ["coding"], who="b").status_code == 404
    assert client.post(f"{BASE}/retests/{item['retest_uuid']}/cancel", headers=admin(world, "b")).status_code == 404
    assert client.post(f"{BASE}/candidates/{reg}/retests", json={"sections": ["coding"]}).status_code in (401, 403)   # anonymous


def test_nothing_to_retest_for_unstarted_or_running_attempts(db, world):
    token, email = h.register_ok(world["job"]["share_token"])
    reg = reg_id(db, email)
    assert client.get(f"{BASE}/candidates/{reg}/retests", headers=admin(world)).json()["eligible"] is False
    assert assign(world, reg, ["coding"]).status_code == 409
    s = h.start_ok(world["job"]["share_token"], token)
    info = client.get(f"{BASE}/candidates/{reg}/retests", headers=admin(world)).json()
    assert info["eligible"] is False and "right now" in info["ineligible_reason"]
    assert assign(world, reg, ["coding"]).status_code == 409
    assert db.query(models.AssessmentRetest).filter_by(registration_id=reg).count() == 0


# ------------------------------------------------------------------------------ existing credentials, no second registration
def test_student_opens_the_retest_with_the_signed_in_session_and_is_never_asked_to_register(db, world, monkeypatch):
    user, c, original = complete_student(db, world, monkeypatch, name="Maya Retester")
    reg = reg_id(db, user.email)
    before, before_counts = snapshot(db, original["session_uuid"]), counts(db, world)
    item = assign_ok(world, reg, ["coding"])["retests"][0]
    assert item["status"] == "ASSIGNED" and "access_token" not in item          # no token: the student's own login is the credential

    mine = c.get(f"{STUDENT_API}/retests").json()["retests"]
    assert [m["retest_uuid"] for m in mine] == [item["retest_uuid"]] and mine[0]["section"] == "coding"
    info = c.get(f"{PUB}/{item['retest_uuid']}")
    assert info.status_code == 200 and info.json()["can_start"] is True and "questions" not in info.json() and "correct_key" not in info.text and "hidden_test" not in info.text

    started, r = run_coding_retest(db, item, c)                                 # no name / e-mail / phone anywhere in the calls
    assert r.status_code == 200, r.text
    after = snapshot(db, original["session_uuid"])
    assert_untouched(before, after, changed="CODING")
    assert after["overall"] == expected_overall(after["scores"])
    assert counts(db, world) == before_counts
    assert db.query(models.CandidateRegistration).filter_by(student_user_id=user.id).count() == 1
    assert c.get(f"{STUDENT_API}/retests").json()["retests"] == []              # completed: no longer on the student's list
    result = c.get(f"{STUDENT_API}/{world['job']['share_token']}/result")
    assert result.status_code == 200 and result.json()["attempt"]["completed"] is True


def test_students_cannot_open_each_others_retests_and_anonymous_users_must_sign_in(db, world, monkeypatch):
    owner, oc, _ = complete_student(db, world, monkeypatch, name="Owner Student")
    other = make_student(db, world, "Other Student")
    reg = reg_id(db, owner.email)
    item = assign_ok(world, reg, ["coding"])["retests"][0]
    url = f"{PUB}/{item['retest_uuid']}"

    anon = client.get(url)
    assert anon.status_code == 401 and anon.json()["detail"]["code"] == "SIGN_IN_REQUIRED"
    assert client.post(f"{url}/start", json={"acknowledged": True}).status_code == 401
    oc_other = signed_in(other)
    assert oc_other.get(url).status_code == 404 and oc_other.post(f"{url}/start", json={"acknowledged": True}).status_code == 404
    assert oc_other.get(f"{STUDENT_API}/retests").json()["retests"] == []
    assert owner.email not in oc_other.get(f"{STUDENT_API}/retests").text
    assert retest_row(db, item["retest_uuid"]).status == "ASSIGNED"             # nothing started
    assert oc.get(url).status_code == 200


def test_a_sitting_started_by_a_student_cannot_be_driven_by_anyone_else(db, world, monkeypatch):
    owner, oc, _ = complete_student(db, world, monkeypatch, name="Sitting Owner")
    item = assign_ok(world, reg_id(db, owner.email), ["coding"])["retests"][0]
    started = start_ok(item, oc)
    stolen = client.get(f"{PUB}/{item['retest_uuid']}/state", headers=sitting_headers(started))           # leaked token, no session
    assert stolen.status_code == 401
    assert oc.get(f"{PUB}/{item['retest_uuid']}/state", headers=sitting_headers(started)).status_code == 200


def test_accountless_candidate_needs_the_handed_over_token_and_cannot_use_anothers(db, world, monkeypatch):
    one = complete_accountless(db, world, monkeypatch, name="First Candidate")
    two = complete_accountless(db, world, monkeypatch, name="Second Candidate")
    a = assign_ok(world, one["reg_id"], ["coding"])["retests"][0]
    b = assign_ok(world, two["reg_id"], ["coding"])["retests"][0]
    assert a["access_token"] and b["access_token"] and a["access_token"] != b["access_token"]
    assert retest_row(db, a["retest_uuid"]).access_token_hash != a["access_token"]                       # only a hash is stored
    url = f"{PUB}/{a['retest_uuid']}"
    assert client.get(url).status_code == 404 and client.get(url, headers={"X-Retest-Token": "guess"}).status_code == 404
    assert client.get(url, headers={"X-Retest-Token": b["access_token"]}).status_code == 404             # another candidate's token
    assert client.get(url, headers={"X-Retest-Token": a["access_token"]}).status_code == 200
    assert client.post(f"{url}/start", headers={"X-Retest-Token": b["access_token"]}, json={"acknowledged": True}).status_code == 404
    assert retest_row(db, a["retest_uuid"]).status == "ASSIGNED"
    assert client.post(f"{url}/start", headers={"X-Retest-Token": a["access_token"]}, json={"acknowledged": False}).status_code == 422  # rules first
    started = start_ok(a)
    assert client.post(f"{url}/start", headers={"X-Retest-Token": a["access_token"]}, json={"acknowledged": True}).status_code == 404  # single use
    assert started["state"]["section"]["key"] == "coding"


def test_no_registration_or_second_attempt_is_created_and_the_original_stays_locked(db, world, monkeypatch):
    cand = complete_accountless(db, world, monkeypatch)
    s, job = cand["session"], world["job"]
    item = assign_ok(world, cand["reg_id"], ["coding"])["retests"][0]
    n_regs = counts(db, world)[1]

    # the original sitting and the shared link still refuse everything
    assert client.post(h.sess_url(s, "submit-aptitude"), headers=h.sh(s), json={"answers": {}}).status_code == 409
    assert client.post(h.sess_url(s, "submit-coding"), headers=h.sh(s), json={"solutions": h.GOOD_SOLUTIONS}).status_code == 409
    assert client.post(h.sess_url(s, "start-coding"), headers=h.sh(s)).status_code == 409
    assert h.start(job["share_token"], cand["registration_token"]).status_code in (403, 409)
    assert h.register(job["share_token"], email=cand["email"])[0].status_code == 409
    # the retest capability is worthless against the original attempt, and the original capability against the retest
    started = start_ok(item)
    assert client.post(h.sess_url({"session_uuid": s["session_uuid"]}, "submit-coding"), headers=sitting_headers(started), json={"solutions": {}}).status_code == 403
    assert client.get(f"{PUB}/{item['retest_uuid']}/state", headers=h.sh(s)).status_code == 403
    assert counts(db, world)[1] == n_regs


def test_the_shared_link_keeps_its_own_expiry_and_is_not_a_retest_permit(db, world, monkeypatch):
    cand = complete_accountless(db, world, monkeypatch)
    job = world["job"]
    item = assign_ok(world, cand["reg_id"], ["coding"])["retests"][0]
    db.expire_all()
    jd = db.query(models.JobDescription).filter_by(share_token=job["share_token"]).one()
    old = jd.share_link_expires_at
    jd.share_link_expires_at = clock.naive_utc(clock.now() - timedelta(hours=1))
    db.commit()
    try:
        assert client.get(f"/api/public/assessment/{job['share_token']}").status_code == 410                          # unchanged policy
        assert h.register(job["share_token"])[0].status_code == 410
        assert start_retest(item).status_code == 200                                                                  # the retest is its own permit
    finally:
        jd.share_link_expires_at = old
        db.commit()
    # link possession alone never reopens a completed attempt: the link token is not accepted as a retest credential
    assert client.get(f"{PUB}/{job['share_token']}").status_code == 404


# ------------------------------------------------------------------------------ only the assigned section
def test_only_the_assigned_section_is_reachable(db, world, monkeypatch):
    cand = complete_accountless(db, world, monkeypatch)
    item = assign_ok(world, cand["reg_id"], ["coding"])["retests"][0]
    started = start_ok(item)
    base, hd = f"{PUB}/{item['retest_uuid']}", sitting_headers(started)
    state = client.get(f"{base}/state", headers=hd).json()
    assert state["section"]["key"] == "coding" and state["section"]["total_sections"] == 1
    assert client.post(f"{base}/start-section/aptitude", headers=hd).status_code == 403
    assert client.post(f"{base}/start-section/interview", headers=hd).status_code == 403
    assert client.post(f"{base}/start-section/coding", headers=hd).status_code == 200
    assert client.put(f"{base}/draft", headers=hd, json={"section": "aptitude", "payload": {"answers": {}}}).status_code == 403
    assert client.post(f"{base}/voice-init", headers=hd).status_code == 403
    assert client.post(f"{base}/voice-turn", headers=hd, data={"history": "[]", "opening": "true"}).status_code == 403
    assert client.post(f"{base}/voice-caption-token", headers=hd).status_code == 403
    assert client.post(f"{base}/run-code", headers=hd, json={"problem_id": "C1", "code": h.GOOD_SOLUTIONS["C1"]["code"]}).status_code == 200


def test_the_section_to_grade_comes_from_the_assignment_not_from_the_request(db, world, monkeypatch):
    cand = complete_accountless(db, world, monkeypatch, coding_good=True)
    uuid = cand["session"]["session_uuid"]
    before = snapshot(db, uuid)
    item = assign_ok(world, cand["reg_id"], ["interview"])["retests"][0]
    started = start_ok(item)
    # a coding payload sent for an INTERVIEW retest is ignored: only the assigned (interview) section is graded
    r = client.post(f"{PUB}/{item['retest_uuid']}/submit", headers=sitting_headers(started), json={"solutions": h.GOOD_SOLUTIONS})
    assert r.status_code == 200, r.text
    after = snapshot(db, uuid)
    assert_untouched(before, after, changed="INTERVIEW")
    assert after["rounds"]["CODING"][3:5] == before["rounds"]["CODING"][3:5]       # the coding evaluation / submission were not replaced


def test_a_score_cannot_be_supplied_by_the_candidate(db, world, monkeypatch):
    cand = complete_accountless(db, world, monkeypatch)
    uuid = cand["session"]["session_uuid"]
    item = assign_ok(world, cand["reg_id"], ["coding"])["retests"][0]
    started = start_ok(item)
    r = client.post(f"{PUB}/{item['retest_uuid']}/submit", headers=sitting_headers(started),
                    json={"solutions": BAD_SOLUTIONS, "score": 100, "retest_score": 100, "overall_score": 100, "coding_score": 100})
    assert r.status_code == 200
    after = snapshot(db, uuid)
    assert after["scores"]["CODING"] == 0.0                                      # graded from the code, never from the request


# ------------------------------------------------------------------------------ failure paths never touch the effective score
def test_abandoned_retest_keeps_the_previous_score_and_frees_the_slot(db, world, monkeypatch):
    cand = complete_accountless(db, world, monkeypatch)
    uuid, reg = cand["session"]["session_uuid"], cand["reg_id"]
    before = snapshot(db, uuid)
    item = assign_ok(world, reg, ["coding"])["retests"][0]
    started = start_ok(item)
    assert client.put(f"{PUB}/{item['retest_uuid']}/draft", headers=sitting_headers(started), json={"section": "coding", "payload": {"solutions": h.GOOD_SOLUTIONS}}).status_code == 200
    # a reload: the lease is lost (it lives in memory only), the heartbeat is stale -> abandoned by server evidence
    row = retest_row(db, item["retest_uuid"])
    row.last_heartbeat_at = clock.naive_utc(clock.now() - timedelta(minutes=5))
    db.commit()
    lost = client.post(f"{PUB}/{item['retest_uuid']}/heartbeat", headers={"X-Session-Token": started["session_token"]})   # no lease any more
    assert lost.status_code == 409 and "cannot be resumed" in lost.json()["detail"]
    client.get(f"{BASE}/candidates/{reg}/retests", headers=admin(world))          # the administrator's view settles it too
    assert retest_row(db, item["retest_uuid"]).status == "ABANDONED"
    assert snapshot(db, uuid) == before
    assert client.post(f"{PUB}/{item['retest_uuid']}/submit", headers=sitting_headers(started), json={"solutions": h.GOOD_SOLUTIONS}).status_code == 409
    assert snapshot(db, uuid) == before
    assert assign(world, reg, ["coding"]).status_code == 201                      # and the administrator can try again


def test_a_second_tab_cannot_hijack_or_abandon_a_live_retest_sitting(db, world, monkeypatch):
    cand = complete_accountless(db, world, monkeypatch)
    item = assign_ok(world, cand["reg_id"], ["coding"])["retests"][0]
    started = start_ok(item)
    r = client.post(f"{PUB}/{item['retest_uuid']}/heartbeat", headers={"X-Session-Token": started["session_token"], "X-Session-Lease": "wrong"})
    assert r.status_code == 409 and "another window" in r.json()["detail"]
    assert retest_row(db, item["retest_uuid"]).status == "IN_PROGRESS"
    assert client.post(f"{PUB}/{item['retest_uuid']}/heartbeat", headers=sitting_headers(started)).status_code == 200


def test_unavailable_evaluation_keeps_the_old_score_and_a_retry_applies_it_once(db, world, monkeypatch):
    cand = complete_accountless(db, world, monkeypatch)
    uuid, reg = cand["session"]["session_uuid"], cand["reg_id"]
    before = snapshot(db, uuid)
    item = assign_ok(world, reg, ["coding"])["retests"][0]
    h.install_local_sandbox(monkeypatch, fail=True)                                # the sandbox is down
    started, r = run_coding_retest(db, item)
    assert r.status_code == 200 and r.json().get("evaluation_pending") is True
    assert retest_row(db, item["retest_uuid"]).status == "EVALUATION_PENDING"
    assert snapshot(db, uuid) == before and roster_row(world, reg)["coding_score"] == 0.0
    assert client.post(f"{PUB}/{item['retest_uuid']}/submit", headers=sitting_headers(started), json={"solutions": h.GOOD_SOLUTIONS}).status_code == 409

    h.install_local_sandbox(monkeypatch)                                           # sandbox is back; the administrator retries
    retry = client.post(f"{BASE}/retests/{item['retest_uuid']}/retry-evaluation", headers=admin(world))
    assert retry.status_code == 200, retry.text
    after = snapshot(db, uuid)
    assert after["scores"]["CODING"] > 0 and after["overall"] == expected_overall(after["scores"])
    assert_untouched(before, after, changed="CODING")
    again = client.post(f"{BASE}/retests/{item['retest_uuid']}/retry-evaluation", headers=admin(world))
    assert again.status_code == 409 and snapshot(db, uuid) == after


def test_an_evaluator_crash_never_changes_the_score(db, world, monkeypatch):
    cand = complete_accountless(db, world, monkeypatch)
    uuid = cand["session"]["session_uuid"]
    before = snapshot(db, uuid)
    item = assign_ok(world, cand["reg_id"], ["coding"])["retests"][0]

    def boom(*a, **k):
        raise RuntimeError("evaluator exploded")

    monkeypatch.setattr(flow, "evaluate_round", boom)
    started, r = run_coding_retest(db, item)
    assert r.status_code == 200 and r.json().get("evaluation_pending") is True
    assert retest_row(db, item["retest_uuid"]).status == "EVALUATION_PENDING" and snapshot(db, uuid) == before


def test_the_ai_interview_being_unavailable_keeps_the_old_interview_score(db, world, monkeypatch):
    cand = complete_accountless(db, world, monkeypatch, coding_good=True)
    uuid = cand["session"]["session_uuid"]
    before = snapshot(db, uuid)
    item = assign_ok(world, cand["reg_id"], ["interview"])["retests"][0]
    started = start_ok(item)
    h.patch_interview_eval(monkeypatch, score=99.0, source="fallback_default")     # the AI service is down: the engine reports a fallback
    r = client.post(f"{PUB}/{item['retest_uuid']}/submit", headers=sitting_headers(started), json={"answers": {f"I{i}": "answer" for i in range(1, 6)}})
    assert r.status_code == 200 and r.json().get("evaluation_pending") is True
    assert snapshot(db, uuid) == before


def test_a_retest_that_ran_out_of_time_with_nothing_saved_expires_without_a_score(db, world, monkeypatch):
    cand = complete_accountless(db, world, monkeypatch)
    uuid, reg = cand["session"]["session_uuid"], cand["reg_id"]
    before = snapshot(db, uuid)
    item = assign_ok(world, reg, ["coding"])["retests"][0]
    started = start_ok(item)
    row = retest_row(db, item["retest_uuid"])
    row.section_deadline_at = clock.naive_utc(clock.now() - timedelta(minutes=2))
    db.commit()
    r = client.get(f"{PUB}/{item['retest_uuid']}/state", headers=sitting_headers(started))
    assert r.status_code == 200 and r.json()["terminal"] is True
    assert retest_row(db, item["retest_uuid"]).status == "EXPIRED" and snapshot(db, uuid) == before


def test_an_unstarted_retest_expires_after_its_validity_window(db, world, monkeypatch):
    cand = complete_accountless(db, world, monkeypatch)
    item = assign_ok(world, cand["reg_id"], ["coding"])["retests"][0]
    row = retest_row(db, item["retest_uuid"])
    row.expires_at = clock.naive_utc(clock.now() - timedelta(minutes=1))
    db.commit()
    assert start_retest(item).status_code == 409
    assert retest_row(db, item["retest_uuid"]).status == "EXPIRED"


# ------------------------------------------------------------------------------ duplicates and concurrency
def test_a_duplicate_submission_cannot_apply_twice(db, world, monkeypatch):
    cand = complete_accountless(db, world, monkeypatch)
    uuid = cand["session"]["session_uuid"]
    item = assign_ok(world, cand["reg_id"], ["coding"])["retests"][0]
    started, first = run_coding_retest(db, item)
    assert first.status_code == 200
    applied = snapshot(db, uuid)
    row_after_first = retest_row(db, item["retest_uuid"])
    stamp, snap = row_after_first.completed_at, copy.deepcopy(row_after_first.previous_snapshot)
    again = client.post(f"{PUB}/{item['retest_uuid']}/submit", headers=sitting_headers(started), json={"solutions": BAD_SOLUTIONS})
    assert again.status_code == 409
    assert snapshot(db, uuid) == applied
    # the acceptance step itself is idempotent too (a repeated delivery of the same evaluation)
    out = svc._finish(db, row_after_first.id, {"status": "EVALUATED", "score": 1.0})
    assert out.get("duplicate") is True and snapshot(db, uuid) == applied
    row = retest_row(db, item["retest_uuid"])
    assert row.completed_at == stamp and row.previous_snapshot == snap


def test_concurrent_acceptance_applies_exactly_once(db, world, monkeypatch):
    cand = complete_accountless(db, world, monkeypatch)
    uuid = cand["session"]["session_uuid"]
    before = snapshot(db, uuid)
    item = assign_ok(world, cand["reg_id"], ["coding"])["retests"][0]
    started = start_ok(item)
    pk = retest_row(db, item["retest_uuid"]).id
    row = retest_row(db, item["retest_uuid"])
    row.status, row.submission_payload = "SUBMITTED", {"solutions": h.GOOD_SOLUTIONS, "final": True}
    db.commit()
    evaluation = {"status": "EVALUATED", "score": 75.0, "problems": []}
    results, errors = [], []

    def worker(score):
        s = h.new_session()
        try:
            results.append(svc._finish(s, pk, {**evaluation, "score": score}))
        except Exception as exc:   # a lock timeout is acceptable; a double application is not
            errors.append(exc)
        finally:
            s.close()

    threads = [threading.Thread(target=worker, args=(sc,)) for sc in (75.0, 40.0, 10.0)]
    [t.start() for t in threads]
    [t.join(30) for t in threads]
    after = snapshot(db, uuid)
    applied = [r for r in results if not r.get("duplicate")]
    assert len(applied) == 1 and not errors, errors
    winner = retest_row(db, item["retest_uuid"])
    assert winner.status == "COMPLETED" and after["scores"]["CODING"] == winner.retest_score
    assert winner.previous_snapshot["score"] == before["rounds"]["CODING"][2]       # archived exactly once: the ORIGINAL evidence
    assert_untouched(before, after, changed="CODING")
    assert after["overall"] == expected_overall(after["scores"])


# ------------------------------------------------------------------------------ the existing completion rules
def test_retest_of_an_incomplete_attempt_does_not_complete_it(db, world, monkeypatch):
    job = world["job"]
    token, email = h.register_ok(job["share_token"], name="Walked Away")
    s = h.start_ok(job["share_token"], token)
    assert client.post(h.sess_url(s, "submit-aptitude"), headers=h.sh(s), json={"answers": h.correct_aptitude_answers(db, s["session_uuid"], 12)}).status_code == 200
    assert flow.abandon_session(db, h.session_row(db, s["session_uuid"]).id, "heartbeat_lost")
    h.reset_public_limiters()
    reg = reg_id(db, email)
    before = snapshot(db, s["session_uuid"])
    assert before["state"] == "ABANDONED" and before["rounds"]["INTERVIEW"][1] == "UNATTEMPTED"
    assert roster_row(world, reg)["overall_score"] is None and roster_row(world, reg)["interview_score"] is None

    item = assign_ok(world, reg, ["interview"])["retests"][0]
    started = start_ok(item)
    h.patch_interview_eval(monkeypatch, score=60.0)
    assert client.post(f"{PUB}/{item['retest_uuid']}/submit", headers=sitting_headers(started), json={"answers": {f"I{i}": "answer" for i in range(1, 6)}}).status_code == 200
    after = snapshot(db, s["session_uuid"])
    assert after["state"] == "ABANDONED" and after["completed_at"] is None            # still not completed: the rule is not relaxed
    assert after["scores"]["INTERVIEW"] == 60.0 and after["scores"]["APTITUDE"] == before["scores"]["APTITUDE"]
    assert after["rounds"]["APTITUDE"] == before["rounds"]["APTITUDE"] and after["rounds"]["CODING"] == before["rounds"]["CODING"]
    row = roster_row(world, reg)
    assert row["overall_score"] is None and row["interview_score"] == 60.0 and row["status"] == "ABANDONED"


def test_a_pending_evaluation_attempt_completes_through_the_existing_rule(db, world, monkeypatch):
    job = world["job"]
    h.install_local_sandbox(monkeypatch, fail=True)
    token, email = h.register_ok(job["share_token"], name="Pending Eval")
    s = h.start_ok(job["share_token"], token)
    assert client.post(h.sess_url(s, "submit-aptitude"), headers=h.sh(s), json={"answers": h.correct_aptitude_answers(db, s["session_uuid"])}).status_code == 200
    client.post(h.sess_url(s, "submit-coding"), headers=h.sh(s), json={"solutions": h.GOOD_SOLUTIONS})      # 503: evaluation pending
    r = client.post(h.sess_url(s, "submit-interview"), headers=h.sh(s), json={"answers": {f"I{i}": "answer" for i in range(1, 6)}})
    assert r.status_code == 200 and h.session_row(db, s["session_uuid"]).current_state == "EVALUATION_PENDING"
    reg = reg_id(db, email)
    h.install_local_sandbox(monkeypatch)
    before = snapshot(db, s["session_uuid"])
    item = assign_ok(world, reg, ["coding"])["retests"][0]
    started, r = run_coding_retest(db, item)
    assert r.status_code == 200
    after = snapshot(db, s["session_uuid"])
    assert after["state"] == "COMPLETED" and after["overall"] == expected_overall(after["scores"])
    assert after["rounds"]["APTITUDE"] == before["rounds"]["APTITUDE"] and after["rounds"]["INTERVIEW"] == before["rounds"]["INTERVIEW"]


def test_the_original_registration_and_sessions_are_never_duplicated_across_many_retests(db, world, monkeypatch):
    cand = complete_accountless(db, world, monkeypatch)
    reg = cand["reg_id"]
    n = counts(db, world)
    for section in ("coding", "aptitude", "coding"):
        item = assign_ok(world, reg, [section])["retests"][0]
        started = start_ok(item)
        body = {"solutions": h.GOOD_SOLUTIONS} if section == "coding" else {"answers": correct_answers(db, item["retest_uuid"])}
        assert client.post(f"{PUB}/{item['retest_uuid']}/submit", headers=sitting_headers(started), json=body).status_code == 200
    assert counts(db, world) == n
    assert db.query(models.AssessmentRetest).filter_by(registration_id=reg, status="COMPLETED").count() == 3
    assert roster_row(world, reg)["overall_score"] == expected_overall({k: getattr(db.query(models.RoleReadySession).filter_by(registration_id=reg).one(), c)
                                                                      for k, c in (("APTITUDE", "aptitude_score"), ("CODING", "coding_score"), ("INTERVIEW", "interview_score"))})


# ------------------------------------------------------------------------------ proctoring reuses the same credential headers
def test_proctoring_accepts_only_a_live_retest_capability(db, world, monkeypatch):
    cand = complete_accountless(db, world, monkeypatch)
    item = assign_ok(world, cand["reg_id"], ["coding"])["retests"][0]
    assert svc.authorize_proctoring.__name__ == "authorize_proctoring"
    started = start_ok(item)
    assert isinstance(svc.authorize_proctoring(db, item["retest_uuid"], started["session_token"]), int)
    with pytest.raises(Exception):
        svc.authorize_proctoring(db, item["retest_uuid"], "wrong")
    client.post(f"{BASE}/retests/{item['retest_uuid']}/cancel", headers=admin(world))
    with pytest.raises(Exception):
        svc.authorize_proctoring(db, item["retest_uuid"], started["session_token"])


def test_migration_is_idempotent(db):
    import database
    import migrate_assessment_retests
    assert migrate_assessment_retests.apply(database.engine) == []


# ==============================================================================================================================
# Candidate e-mail (SMTP is always the fake server: tests/conftest.py forbids real connections)
# ==============================================================================================================================
import re
import smtplib

from services import email_service
from services import retest_notification as notif
from tests.test_assessment_invitations import FakeSmtpServer

FRONTEND = "https://app.prepwin.test"
LINK_RE = re.compile(r"https://app\.prepwin\.test/assessment/retest/([0-9a-f-]{36})(?:\?token=(\S+))?")


@pytest.fixture
def smtp(monkeypatch):
    server = FakeSmtpServer()
    monkeypatch.setattr(smtplib, "SMTP", server.factory("plain"))
    monkeypatch.setattr(smtplib, "SMTP_SSL", server.factory("ssl"))
    monkeypatch.setattr(email_service, "_sleep", lambda s: None)
    monkeypatch.setenv("SMTP_HOST", "mail.prepwin.test")
    monkeypatch.setenv("SMTP_PORT", "587")
    monkeypatch.setenv("SMTP_USER", "mailer@prepwin.test")
    monkeypatch.setenv("SMTP_PASSWORD", "S3cret-Smtp-Pa55word")
    monkeypatch.setenv("SMTP_FROM", "PrepWin <mailer@prepwin.test>")
    monkeypatch.delenv("SMTP_SECURITY", raising=False)
    monkeypatch.setenv("FRONTEND_URL", FRONTEND)
    return server


def body_of(msg):
    return msg.get_body(preferencelist=("plain",)).get_content()


def html_of(msg):
    return msg.get_body(preferencelist=("html",)).get_content()


def links_in(msg):
    return [(m.group(1), m.group(2)) for m in LINK_RE.finditer(body_of(msg))]


def format_dt(dt):
    return clock.aware(dt).strftime("%d %b %Y at %H:%M")


def resend(world, retest_uuid, who="a"):
    return client.post(f"{BASE}/retests/{retest_uuid}/resend-email", headers=admin(world, who))


def test_assignment_sends_one_email_to_the_registered_address_with_the_assigned_section_and_a_working_link(db, world, monkeypatch, smtp):
    cand = complete_accountless(db, world, monkeypatch, name="Mail Candidate")
    r = assign(world, cand["reg_id"], ["coding"], reason="The code runner failed during the original sitting")
    assert r.status_code == 201, r.text
    body = r.json()
    item = body["retests"][0]
    assert body["email"]["status"] == "SENT" and body["email"]["to"] == cand["email"] and body["email_outcome"] == "sent"
    assert "access_token" not in item, "once the mail is SENT no token leaves the server again"

    assert len(smtp.sent) == 1 and smtp.sent[0][0] == cand["email"]
    msg = smtp.sent[0][1]
    assert msg["Subject"] == "Retest Assigned — PrepWin Assessment" and cand["email"] in msg["To"]
    text, html = body_of(msg), html_of(msg)
    for needle in ("Hello Mail Candidate,", "A retest has been assigned to you for your assessment on PrepWin.", "Job Role: Backend Engineer",
                   "Assigned Section(s): Coding", "Reason: The code runner failed during the original sitting", "Retest Valid Until:", " UTC",
                   "Start Retest", "Only the section listed in this email is authorized for retesting. Your other assessment results will remain unchanged.",
                   "PrepWin Assessment Team"):
        assert needle in text, needle
    assert "Start Retest" in html and 'href="https://app.prepwin.test/assessment/retest/' in html
    row = retest_row(db, item["retest_uuid"])
    assert format_dt(row.expires_at) in text, "the expiry comes from the stored assignment"

    # nothing sensitive: no SMTP secret, session/lease secrets, registration token, phone number, answers or scores
    for secret in ("S3cret-Smtp-Pa55word", cand["session"]["session_token"], cand["session"]["session_lease"], cand["registration_token"], "+14155550123", "answers"):
        assert secret not in text and secret not in html, secret
    assert not re.search(r"\d\s?%", text + re.sub(r"<[^>]*>", "", html)), "no score appears in the e-mail"
    assert "Aptitude" not in text and "Interview" not in text, "only the assigned section is mentioned"

    # the link in the mail is the credential (accountless): it opens exactly this retest and only that one
    (uuid, token), = links_in(msg)
    assert uuid == item["retest_uuid"] and token
    assert retest_row(db, uuid).access_token_hash not in (None, token)
    assert client.get(f"{PUB}/{uuid}", headers={"X-Retest-Token": token}).json()["section"] == "coding"
    assert client.get(f"{PUB}/{uuid}").status_code == 404

    # tracked: the assignment is persisted AND the mail is recorded SENT, as separate facts
    db.expire_all()
    row = retest_row(db, uuid)
    assert (row.status, row.email_status, row.email_attempts, row.email_recipient) == ("ASSIGNED", "SENT", 1, cand["email"])
    assert row.email_sent_at is not None and row.email_last_error is None


def test_a_student_gets_a_link_without_any_token_and_signs_in_with_the_existing_account(db, world, monkeypatch, smtp):
    user, c, original = complete_student(db, world, monkeypatch, name="Mail Student")
    reg = reg_id(db, user.email)
    body = assign_ok(world, reg, ["coding"])
    assert body["email"]["status"] == "SENT" and smtp.sent[0][0] == user.email
    (uuid, token), = links_in(smtp.sent[0][1])
    assert token is None and uuid == body["retests"][0]["retest_uuid"], "a student's own sign-in is the credential"
    assert client.get(f"{PUB}/{uuid}").status_code == 401                         # anonymous: sign in first (no registration form)
    assert c.get(f"{PUB}/{uuid}").status_code == 200                              # the signed-in owner
    assert signed_in(make_student(db, world, "Not The Owner")).get(f"{PUB}/{uuid}").status_code == 404


def test_several_sections_assigned_together_are_announced_in_one_email_with_one_link_each(db, world, monkeypatch, smtp):
    cand = complete_accountless(db, world, monkeypatch)
    body = assign_ok(world, cand["reg_id"], ["coding", "interview"])
    assert len(smtp.sent) == 1
    text = body_of(smtp.sent[0][1])
    assert "Assigned Section(s): Coding, AI Technical Interview" in text
    assert {u for u, _ in links_in(smtp.sent[0][1])} == {r["retest_uuid"] for r in body["retests"]}
    assert text.count("Start Retest") == 2 and "Only the sections listed in this email are authorized" in text
    assert {r["email"]["status"] for r in body["retests"]} == {"SENT"}


def test_the_assignment_is_committed_before_any_mail_is_attempted(db, world, monkeypatch, smtp):
    cand = complete_accountless(db, world, monkeypatch)
    seen = {}
    real_send = email_service.send

    def spy(settings, to, subject, html, text, to_name=None):
        other = h.new_session()                                                   # a separate connection sees only COMMITTED data
        try:
            rows = other.query(models.AssessmentRetest).filter_by(registration_id=cand["reg_id"]).all()
            seen["rows"] = [(r.status, r.email_status) for r in rows]
        finally:
            other.close()
        return real_send(settings, to, subject, html, text, to_name)

    monkeypatch.setattr(email_service, "send", spy)
    assign_ok(world, cand["reg_id"], ["coding"])
    assert seen["rows"] == [("ASSIGNED", "PENDING")]


def test_an_smtp_failure_keeps_the_assignment_marks_the_mail_failed_and_gives_the_admin_a_fallback_link(db, world, monkeypatch, smtp):
    cand = complete_accountless(db, world, monkeypatch)
    smtp.connect_error = OSError("mail server down")
    r = assign(world, cand["reg_id"], ["coding"])
    assert r.status_code == 201, r.text                                           # the assignment itself succeeded
    body = r.json()
    item = body["retests"][0]
    assert body["email"]["status"] == "FAILED" and body["email_outcome"] == "failed" and "connect" in body["email"]["error"].lower()
    assert item["status"] == "ASSIGNED" and item["email"]["status"] == "FAILED" and item["access_token"], "recoverable: the admin can hand the link over"
    assert smtp.sent == []
    row = retest_row(db, item["retest_uuid"])
    assert (row.status, row.email_status, row.email_sent_at) == ("ASSIGNED", "FAILED", None)
    assert "mail server down" not in (row.email_last_error or ""), "no raw provider text is stored"
    info = client.get(f"{BASE}/candidates/{cand['reg_id']}/retests", headers=admin(world)).json()
    assert info["history"][0]["email"]["status"] == "FAILED" and info["sections"][1]["active_retest"]["email"]["status"] == "FAILED"


def test_a_failed_email_can_be_retried_without_a_second_assignment_and_is_never_sent_twice(db, world, monkeypatch, smtp):
    cand = complete_accountless(db, world, monkeypatch)
    smtp.connect_error = OSError("down")
    first = assign_ok(world, cand["reg_id"], ["coding"])["retests"][0]
    old_token = first["access_token"]
    smtp.connect_error = None

    r = resend(world, first["retest_uuid"])
    assert r.status_code == 200, r.text
    assert r.json()["email"]["status"] == "SENT" and r.json()["email"]["attempts"] == 2
    assert "access_token" not in r.json()["retests"][0]
    db.expire_all()
    assert db.query(models.AssessmentRetest).filter_by(registration_id=cand["reg_id"]).count() == 1, "no duplicate assignment"
    assert len(smtp.sent) == 1
    (uuid, new_token), = links_in(smtp.sent[0][1])
    assert uuid == first["retest_uuid"] and new_token != old_token
    assert client.get(f"{PUB}/{uuid}", headers={"X-Retest-Token": old_token}).status_code == 404       # the undelivered token was rotated
    assert client.get(f"{PUB}/{uuid}", headers={"X-Retest-Token": new_token}).status_code == 200

    again = resend(world, first["retest_uuid"])                                                         # SENT is never re-sent
    assert again.status_code == 409 and "already sent" in again.json()["detail"].lower() and len(smtp.sent) == 1
    assert assign(world, cand["reg_id"], ["coding"]).status_code == 409                                  # nor does a repeated assignment mail again
    assert len(smtp.sent) == 1
    assert retest_row(db, uuid).email_status == "SENT"


def test_a_missing_smtp_configuration_is_reported_as_a_failed_email_not_as_sent(db, world, monkeypatch, smtp):
    cand = complete_accountless(db, world, monkeypatch)
    monkeypatch.delenv("SMTP_HOST", raising=False)
    body = assign_ok(world, cand["reg_id"], ["coding"])
    assert body["email"]["status"] == "FAILED" and "not configured" in body["email"]["error"].lower()
    assert smtp.connections == [] and retest_row(db, body["retests"][0]["retest_uuid"]).email_sent_at is None


def test_a_localhost_application_url_in_production_never_produces_a_useless_link(db, world, monkeypatch, smtp):
    cand = complete_accountless(db, world, monkeypatch)
    monkeypatch.setenv("FRONTEND_URL", "http://localhost:5173")
    monkeypatch.setattr(notif.utils, "is_production", lambda: True)
    body = assign_ok(world, cand["reg_id"], ["coding"])
    assert body["email"]["status"] == "FAILED" and "FRONTEND_URL" in body["email"]["error"] and smtp.sent == []


def test_an_invalid_registered_address_is_refused_before_anything_is_created(db, world, monkeypatch, smtp):
    cand = complete_accountless(db, world, monkeypatch)
    reg = db.query(models.CandidateRegistration).filter_by(id=cand["reg_id"]).one()
    good, reg.email = reg.email, "not-an-address"
    db.commit()
    try:
        r = assign(world, cand["reg_id"], ["coding"])
        assert r.status_code == 422 and "e-mail" in r.json()["detail"].lower()
        db.expire_all()
        assert db.query(models.AssessmentRetest).filter_by(registration_id=cand["reg_id"]).count() == 0 and smtp.sent == []
    finally:
        reg.email = good
        db.commit()


def test_a_cancelled_section_is_not_mentioned_when_the_rest_of_the_batch_is_retried(db, world, monkeypatch, smtp):
    cand = complete_accountless(db, world, monkeypatch)
    smtp.connect_error = OSError("down")
    items = {i["section"]: i for i in assign_ok(world, cand["reg_id"], ["coding", "interview"])["retests"]}
    assert client.post(f"{BASE}/retests/{items['interview']['retest_uuid']}/cancel", headers=admin(world)).status_code == 200
    smtp.connect_error = None
    assert resend(world, items["coding"]["retest_uuid"]).json()["email_outcome"] == "sent"
    text = body_of(smtp.sent[0][1])
    assert "Assigned Section(s): Coding" in text and "Interview" not in text
    assert resend(world, items["interview"]["retest_uuid"]).status_code == 409           # a cancelled retest has no mail to retry


def test_two_simultaneous_retries_send_exactly_one_email(db, world, monkeypatch, smtp):
    cand = complete_accountless(db, world, monkeypatch)
    smtp.connect_error = OSError("down")
    item = assign_ok(world, cand["reg_id"], ["coding"])["retests"][0]
    smtp.connect_error = None
    batch = retest_row(db, item["retest_uuid"]).notify_batch
    results = []

    def worker():
        s = h.new_session()
        try:
            results.append(notif.deliver(s, batch)["status"])
        finally:
            s.close()

    threads = [threading.Thread(target=worker) for _ in range(3)]
    [t.start() for t in threads]
    [t.join(30) for t in threads]
    assert sorted(results) == ["sent", "skipped", "skipped"] and len(smtp.sent) == 1


def test_email_endpoints_are_tenant_scoped_and_authenticated(db, world, monkeypatch, smtp):
    cand = complete_accountless(db, world, monkeypatch)
    smtp.connect_error = OSError("down")
    item = assign_ok(world, cand["reg_id"], ["coding"])["retests"][0]
    smtp.connect_error = None
    assert resend(world, item["retest_uuid"], who="b").status_code == 404
    assert client.post(f"{BASE}/retests/{item['retest_uuid']}/resend-email").status_code in (401, 403)
    assert retest_row(db, item["retest_uuid"]).email_status == "FAILED" and smtp.sent == []


def test_the_emailed_link_completes_the_retest_end_to_end_and_updates_only_that_section(db, world, monkeypatch, smtp):
    cand = complete_accountless(db, world, monkeypatch)
    uuid0 = cand["session"]["session_uuid"]
    before = snapshot(db, uuid0)
    assign_ok(world, cand["reg_id"], ["coding"])
    (uuid, token), = links_in(smtp.sent[0][1])                                    # the candidate only has the e-mail
    item = {"retest_uuid": uuid, "access_token": token}
    started, r = run_coding_retest(db, item)
    assert r.status_code == 200, r.text
    after = snapshot(db, uuid0)
    assert after["scores"]["CODING"] > before["scores"]["CODING"] and after["overall"] == expected_overall(after["scores"])
    assert_untouched(before, after, changed="CODING")


def test_the_migration_adds_the_notification_columns_to_a_table_from_the_first_release(tmp_path):
    from sqlalchemy import create_engine, inspect, text
    import migrate_assessment_retests as mig
    engine = create_engine(f"sqlite:///{(tmp_path / 'old.db').as_posix()}")
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE assessment_retests (id INTEGER PRIMARY KEY, retest_uuid VARCHAR(64) NOT NULL)"))
        conn.execute(text("INSERT INTO assessment_retests (id, retest_uuid) VALUES (1, 'keep-me')"))
    added = mig.apply(engine)
    assert set(added) == {f"assessment_retests.{c}" for c in mig.LATER_COLUMNS}
    cols = {c["name"] for c in inspect(engine).get_columns("assessment_retests")}
    assert set(mig.LATER_COLUMNS) <= cols
    with engine.connect() as conn:
        row = conn.execute(text("SELECT retest_uuid, email_status, email_attempts FROM assessment_retests")).one()
    assert tuple(row) == ("keep-me", "PENDING", 0), "existing rows are preserved and default to PENDING"
    assert mig.apply(engine) == []


# ==============================================================================================================================
# 24-hour validity: assigned_at + VALIDITY_HOURS, enforced by the server clock (>=), at every way in
# ==============================================================================================================================
from datetime import datetime, timezone
from types import SimpleNamespace

DAY = timedelta(hours=24)


@pytest.fixture
def fake(monkeypatch):
    """The controllable server clock (starts at the real now, so the attempts created before it was installed stay consistent)."""
    fc = h.FakeClock(datetime.now(timezone.utc))
    monkeypatch.setattr(clock, "now", fc.now)
    return fc


def assigned_row(db, world, monkeypatch, **kw):
    cand = complete_accountless(db, world, monkeypatch, **kw)
    item = assign_ok(world, cand["reg_id"], ["coding"])["retests"][0]
    return cand, item, retest_row(db, item["retest_uuid"])


def test_a_new_retest_is_valid_for_exactly_24_hours_from_one_constant(db, world, monkeypatch, smtp):
    import inspect
    assert svc.VALIDITY_HOURS == 24
    src = inspect.getsource(svc) + inspect.getsource(notif)
    assert "VALIDITY_DAYS" not in src and src.count("VALIDITY_HOURS =") == 1, "one constant, no second validity value anywhere"
    assert "timedelta(days=" not in inspect.getsource(svc), "no hard-coded expiry arithmetic besides the constant"
    cand, item, row = assigned_row(db, world, monkeypatch)
    assert clock.aware(row.expires_at) - clock.aware(row.assigned_at) == DAY                       # assigned_at + 24 hours, to the microsecond
    assert item["expires_at"] == clock.aware(row.expires_at).isoformat()
    text = body_of(smtp.sent[0][1])
    assert f"Retest Valid Until: {format_dt(row.assigned_at + DAY)} UTC" in text, "the e-mail shows the stored expiry"
    info = client.get(f"{PUB}/{item['retest_uuid']}", headers={"X-Retest-Token": links_in(smtp.sent[0][1])[0][1]}).json()
    assert info["expires_at"] == item["expires_at"] and info["can_start"] is True


def test_expired_means_the_clock_has_reached_the_expiry_and_a_missing_expiry_is_never_valid():
    exp = datetime(2030, 1, 2, 9, 0, 0, tzinfo=timezone.utc)
    row = SimpleNamespace(expires_at=exp)
    assert svc.expired(row, exp - timedelta(microseconds=1)) is False
    assert svc.expired(row, exp) is True and svc.expired(row, exp + timedelta(seconds=1)) is True
    assert svc.expired(SimpleNamespace(expires_at=None), exp) is True, "no expiry is treated as expired, never as indefinite access"


def test_a_retest_can_be_started_until_the_last_second_but_not_at_the_expiry(db, world, monkeypatch, fake):
    cand_a, item_a, row_a = assigned_row(db, world, monkeypatch)
    cand_b, item_b, row_b = assigned_row(db, world, monkeypatch)
    expires_a, expires_b = clock.aware(row_a.expires_at), clock.aware(row_b.expires_at)

    fake.set(expires_a - timedelta(seconds=1))
    assert start_retest(item_a).status_code == 200                                               # still inside the validity

    fake.set(expires_b)                                                                          # exactly the expiry: no longer valid
    late = start_retest(item_b)
    assert late.status_code == 409 and "expired" in late.json()["detail"].lower()
    assert retest_row(db, item_b["retest_uuid"]).status == "EXPIRED" and retest_row(db, item_b["retest_uuid"]).started_at is None
    info = client.get(f"{PUB}/{item_b['retest_uuid']}", headers={"X-Retest-Token": item_b["access_token"]})
    assert info.status_code in (200, 404) and not (info.status_code == 200 and info.json()["can_start"])
    assert assign(world, cand_b["reg_id"], ["coding"]).status_code == 201                       # an expired retest frees the slot for a new one


def test_a_sitting_never_outlives_the_validity_and_cannot_be_submitted_after_it(db, world, monkeypatch, fake):
    cand, item, row = assigned_row(db, world, monkeypatch)
    uuid0, expires = cand["session"]["session_uuid"], clock.aware(row.expires_at)
    before = snapshot(db, uuid0)

    fake.set(expires - timedelta(minutes=5))                                                     # started with five minutes of validity left
    started = start_ok(item)
    section = started["state"]["section"]
    assert section["remaining_seconds"] == 300 and section["deadline_at"] == expires.isoformat(), "the 20 minute clock is cut to the expiry"
    hd, base = sitting_headers(started), f"{PUB}/{item['retest_uuid']}"
    assert client.put(f"{base}/draft", headers=hd, json={"section": "coding", "payload": {"solutions": h.GOOD_SOLUTIONS}}).status_code == 200

    fake.set(expires)                                                                            # the validity ends
    refused = client.post(f"{base}/submit", headers=hd, json={"solutions": h.GOOD_SOLUTIONS})
    assert refused.status_code == 409 and "expired" in refused.json()["detail"].lower()
    assert retest_row(db, item["retest_uuid"]).status == "EXPIRED"
    gone = client.get(f"{base}/state", headers=hd)                                               # and it cannot be resumed: only a terminal state is reported
    assert gone.status_code == 200 and gone.json()["terminal"] is True and gone.json()["state"] == "EXPIRED" and "section" not in gone.json()
    assert client.post(f"{base}/heartbeat", headers=hd).status_code == 409
    assert client.post(f"{base}/run-code", headers=hd, json={"problem_id": "C1", "code": h.GOOD_SOLUTIONS["C1"]["code"]}).status_code == 409
    assert snapshot(db, uuid0) == before, "nothing was graded or applied, not even the saved draft"
    assert assign(world, cand["reg_id"], ["coding"]).status_code == 201


def test_a_submission_one_second_before_the_expiry_is_accepted(db, world, monkeypatch, fake):
    cand, item, row = assigned_row(db, world, monkeypatch)
    uuid0, expires = cand["session"]["session_uuid"], clock.aware(row.expires_at)
    before = snapshot(db, uuid0)
    fake.set(expires - timedelta(minutes=10))
    started = start_ok(item)
    fake.set(expires - timedelta(seconds=1))
    r = client.post(f"{PUB}/{item['retest_uuid']}/submit", headers=sitting_headers(started), json={"solutions": h.GOOD_SOLUTIONS})
    assert r.status_code == 200, r.text
    after = snapshot(db, uuid0)
    assert after["scores"]["CODING"] > before["scores"]["CODING"] and after["overall"] == expected_overall(after["scores"])


def test_an_expiry_already_stored_is_neither_reset_nor_extended_and_finished_rows_are_left_alone(db, world, monkeypatch, fake):
    legacy_cand, legacy_item, legacy = assigned_row(db, world, monkeypatch)
    other_cand, other_item, other = assigned_row(db, world, monkeypatch)          # every candidate is registered BEFORE the clock jumps ahead
    done_cand, done_item, done = assigned_row(db, world, monkeypatch)
    comp_cand, comp_item, comp = assigned_row(db, world, monkeypatch)
    assigned_at = clock.aware(legacy.assigned_at)
    legacy.expires_at = clock.naive_utc(assigned_at + timedelta(days=7))                          # an assignment made under the old 7-day rule
    db.commit()
    stored = retest_row(db, legacy_item["retest_uuid"]).expires_at

    fake.set(assigned_at + timedelta(hours=25))                                                   # past the NEW period, inside the stored one
    svc.settle(db, legacy.id)
    row = retest_row(db, legacy_item["retest_uuid"])
    assert row.status == "ASSIGNED" and row.expires_at == stored, "not shortened to 24 hours, not rewritten"
    assert start_retest(legacy_item).status_code == 200

    other.expires_at = clock.naive_utc(assigned_at + timedelta(days=7))
    db.commit()
    fake.set(assigned_at + timedelta(days=7))                                                     # the stored expiry is honoured exactly
    assert start_retest(other_item).status_code == 409 and retest_row(db, other_item["retest_uuid"]).status == "EXPIRED"

    # completed / cancelled assignments are never rewritten, whatever their expiry says
    cancelled = client.post(f"{BASE}/retests/{done_item['retest_uuid']}/cancel", headers=admin(world)).json()
    assert cancelled["status"] == "CANCELLED"
    fake.set(assigned_at)
    started, r = run_coding_retest(db, comp_item)
    assert r.status_code == 200 and retest_row(db, comp_item["retest_uuid"]).status == "COMPLETED"
    fake.advance(10 * 24 * 3600)
    for pk in (done.id, comp.id):
        svc.settle(db, pk)
    db.expire_all()
    assert retest_row(db, done_item["retest_uuid"]).status == "CANCELLED" and retest_row(db, comp_item["retest_uuid"]).status == "COMPLETED"


def test_the_admin_and_candidate_views_show_the_stored_expiry(db, world, monkeypatch, smtp):
    cand, item, row = assigned_row(db, world, monkeypatch)
    info = client.get(f"{BASE}/candidates/{cand['reg_id']}/retests", headers=admin(world)).json()
    assert info["history"][0]["expires_at"] == clock.aware(row.expires_at).isoformat()
    assert info["sections"][1]["active_retest"]["expires_at"] == info["history"][0]["expires_at"]


# ==============================================================================================================================
# What the entry page is told about the assigned section (duration + format), from the attempt's own configuration
# ==============================================================================================================================
def test_the_entry_page_is_told_the_assigned_sections_duration_and_format_from_the_attempts_own_questions(db, world, monkeypatch, smtp):
    cand = complete_accountless(db, world, monkeypatch)
    items = {i["section"]: i for i in assign_ok(world, cand["reg_id"], ["aptitude", "coding", "interview"])["retests"]}
    tokens = {u: t for u, t in links_in(smtp.sent[0][1])}
    expected = {"aptitude": ("15 multiple-choice questions", 15), "coding": ("2 programming problems", 2), "interview": ("5 voice-based interview questions", 5)}
    for section, (fmt, count) in expected.items():
        uuid = items[section]["retest_uuid"]
        info = client.get(f"{PUB}/{uuid}", headers={"X-Retest-Token": tokens[uuid]}).json()
        assert (info["format"], info["item_count"], info["minutes"], info["section"]) == (fmt, count, 20, section)
        assert "questions" not in info and "correct_key" not in json.dumps(info), "still no questions or keys before the sitting"
        # the number is what the sitting will actually serve, not just a published default
        round_row = db.query(models.RoleReadyRoundAttempt).filter_by(session_id=retest_row(db, uuid).session_id, round_type=section.upper()).one()
        assert len(round_row.questions_payload) == count
    # a changed configuration is reflected (the count follows the attempt's own round, with the blueprint count only as a fallback)
    row = db.query(models.RoleReadyRoundAttempt).filter_by(session_id=retest_row(db, items["coding"]["retest_uuid"]).session_id, round_type="CODING").one()
    row.questions_payload = row.questions_payload[:1]
    db.commit()
    info = client.get(f"{PUB}/{items['coding']['retest_uuid']}", headers={"X-Retest-Token": tokens[items['coding']['retest_uuid']]}).json()
    assert info["format"] == "1 programming problem"


# ==============================================================================================================================
# Login details in the retest e-mail (students). Accountless candidates have no account, so their e-mail is unchanged.
# ==============================================================================================================================
import logging

from services import credential_delivery

LOGIN_URL = f"{FRONTEND}/student/login"


def retain_password(db, user, password=PASSWORD):
    assert credential_delivery.retain(db, user, password, actor_id=None) is True
    db.commit()


def retained_rows(db, user):
    db.expire_all()
    return db.query(models.CredentialDelivery).filter_by(user_id=user.id).count()


def test_a_student_retest_email_carries_login_details_the_section_and_the_retained_password(db, world, monkeypatch, smtp, caplog):
    user, c, original = complete_student(db, world, monkeypatch, name="Login Student")
    retain_password(db, user)
    hash_before = db.query(models.User.hashed_password).filter_by(id=user.id).scalar()
    with caplog.at_level(logging.DEBUG):
        body = assign_ok(world, reg_id(db, user.email), ["coding"], reason="Runner failed")
    assert body["email"]["status"] == "SENT" and smtp.sent[0][0] == user.email
    msg = smtp.sent[0][1]
    text, html = body_of(msg), html_of(msg)
    for part in (text, html):
        assert "Login Student" in part, "the student's name"
        assert user.email in part and PASSWORD in part, "login ID and password"
        assert LOGIN_URL in part, "the student login page"
        assert "Coding" in part, "the section being retaken"
        assert "Retest Valid Until:" in part and "Runner failed" in part, "existing validity / reason information is kept"
    assert "Assigned Section(s): Coding" in text and "Your login details:" in text
    (uuid, token), = links_in(msg)
    assert uuid == body["retests"][0]["retest_uuid"] and token is None, "the retest link itself is unchanged: no token, no password"
    assert PASSWORD not in f"{FRONTEND}/assessment/retest/{uuid}" and PASSWORD not in caplog.text
    assert "$2b$" not in text and hash_before not in text and hash_before not in html

    # the credentials are untouched and still work; the temporary retained copy was consumed; the retest link still opens for the student
    db.expire_all()
    assert db.query(models.User.hashed_password).filter_by(id=user.id).scalar() == hash_before
    assert retained_rows(db, user) == 0
    fresh = signed_in(user)                                                   # logs in with the very same password
    assert fresh.get(f"{PUB}/{uuid}").status_code == 200


def test_without_a_retained_password_the_retest_email_has_the_login_id_the_login_page_and_how_to_get_a_password(db, world, monkeypatch, smtp):
    user, c, original = complete_student(db, world, monkeypatch, name="No Retained")
    hash_before = db.query(models.User.hashed_password).filter_by(id=user.id).scalar()
    assert assign_ok(world, reg_id(db, user.email), ["aptitude"])["email"]["status"] == "SENT"
    text, html = body_of(smtp.sent[0][1]), html_of(smtp.sent[0][1])
    for part in (text, html):
        assert user.email in part and LOGIN_URL in part and "Aptitude" in part
        assert "not included in this e-mail" in part and "Replace password" in part
        assert PASSWORD not in part and "$2b$" not in part
    db.expire_all()
    assert db.query(models.User.hashed_password).filter_by(id=user.id).scalar() == hash_before, "nothing was generated or reset"


def test_every_section_name_is_identified_in_the_student_email(db, world, monkeypatch, smtp):
    user, c, original = complete_student(db, world, monkeypatch, name="Sections Student")
    body = assign_ok(world, reg_id(db, user.email), ["aptitude", "coding", "interview"])
    text = body_of(smtp.sent[0][1])
    assert "Assigned Section(s): Aptitude, Coding, AI Technical Interview" in text and text.count("Your login details:") == 1
    assert text.count("Start Retest") == 3 and len(smtp.sent) == 1


def test_accountless_candidates_get_the_same_email_as_before_with_no_login_block(db, world, monkeypatch, smtp):
    cand = complete_accountless(db, world, monkeypatch)
    assign_ok(world, cand["reg_id"], ["coding"])
    text, html = body_of(smtp.sent[0][1]), html_of(smtp.sent[0][1])
    assert "login details" not in (text + html).lower() and "student login" not in (text + html).lower()
    assert links_in(smtp.sent[0][1])[0][1], "their link still carries the single-use token"


def test_a_failed_retest_email_keeps_the_retained_password_and_the_retry_includes_it_once(db, world, monkeypatch, smtp):
    user, c, original = complete_student(db, world, monkeypatch, name="Retry Login")
    retain_password(db, user)
    smtp.connect_error = OSError("down")
    item = assign_ok(world, reg_id(db, user.email), ["coding"])["retests"][0]
    assert smtp.sent == [] and retained_rows(db, user) == 1, "nothing delivered: nothing consumed"
    smtp.connect_error = None
    assert resend(world, item["retest_uuid"]).json()["email_outcome"] == "sent"
    assert PASSWORD in body_of(smtp.sent[0][1]) and retained_rows(db, user) == 0 and len(smtp.sent) == 1
    assert resend(world, item["retest_uuid"]).status_code == 409 and len(smtp.sent) == 1


def test_a_changed_password_is_never_sent_in_a_retest_email(db, world, monkeypatch, smtp):
    user, c, original = complete_student(db, world, monkeypatch, name="Changed Pw")
    retain_password(db, user, password="an-old-assigned-pw")                    # not the account's current password
    assign_ok(world, reg_id(db, user.email), ["coding"])
    text = body_of(smtp.sent[0][1])
    assert "an-old-assigned-pw" not in text and PASSWORD not in text and "not included in this e-mail" in text


def test_the_assignment_and_link_behaviour_is_unchanged_by_the_login_block(db, world, monkeypatch, smtp):
    user, c, original = complete_student(db, world, monkeypatch, name="Unchanged Flow")
    retain_password(db, user)
    before = snapshot(db, original["session_uuid"])
    body = assign_ok(world, reg_id(db, user.email), ["coding"])
    item = body["retests"][0]
    assert item["status"] == "ASSIGNED" and item["email"]["status"] == "SENT" and "access_token" not in item
    assert snapshot(db, original["session_uuid"]) == before, "assigning (and mailing) changes no result"
    (uuid, _), = links_in(smtp.sent[0][1])
    started, r = run_coding_retest(db, {"retest_uuid": uuid}, c)
    assert r.status_code == 200
    after = snapshot(db, original["session_uuid"])
    assert after["scores"]["CODING"] > before["scores"]["CODING"] and after["overall"] == expected_overall(after["scores"])
    assert_untouched(before, after, changed="CODING")
