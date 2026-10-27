"""
Recruitment shared-link workflow on the shared assessment engine:
  * backend-enforced rules acknowledgement,
  * the Student Platform's evaluators / formats / voice interview serve public candidates (explicit adapter, capability auth),
  * parity with the Student Platform: identical answers => identical section scores and overall score in both workflows,
  * proctoring evidence and rubric confidentiality.

Sandbox, Gemini and the voice service are MOCKED here (local subprocess / fakes). Nothing in this file proves a live external call.
"""
import json
from datetime import timedelta

import pytest

import models
from services import assessment_clock
from services import assessment_engine as engine
from services import assessment_flow_service as flow
from services import assessment_policy as policy
from services import elevenlabs_service, gemini_client, interview_evaluation, roleready_service as rs
from tests import recruitment_helpers as h
from tests.test_roleready_pipeline import db_session, setup_test_data  # noqa: F401  (student fixtures)

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
    h.reset_public_limiters()
    h.install_local_sandbox(monkeypatch)
    yield
    h.reset_public_limiters()


@pytest.fixture
def clk(monkeypatch):
    fake = h.FakeClock()
    monkeypatch.setattr(assessment_clock, "now", fake.now)
    return fake


def fresh(env):
    token, email = h.register_ok(env["token"])
    return token, email


def started(env):
    token, _ = fresh(env)
    return h.start_ok(env["token"], token)


# ------------------------------------------------------------------------------ rules acknowledgement
def test_start_requires_the_rules_acknowledgement_on_the_server(db, env):
    token, _ = fresh(env)
    assert h.start(env["token"], token, acknowledged=False).status_code == 422
    r = client.post(f"/api/public/assessment/{env['token']}/start", headers={"X-Registration-Token": token})   # no body at all
    assert r.status_code == 422 and "acknowledge" in r.json()["detail"].lower()
    # nothing was consumed and no timer exists: the same registration can still start once the rules are acknowledged
    reg = db.query(models.CandidateRegistration).filter_by(registration_token_hash=flow.sha256_hex(token)).first()
    db.refresh(reg)
    assert reg.status == "REGISTERED" and reg.attempt_session_uuid is None
    assert h.start(env["token"], token, acknowledged=True).status_code == 200


def test_acknowledgement_is_recorded_and_visible_to_the_hiring_team(db, env):
    token, email = fresh(env)
    s = h.start_ok(env["token"], token)
    row = h.session_row(db, s["session_uuid"])
    log = db.query(models.ActivityLog).filter_by(action="ASSESSMENT_RULES_ACKNOWLEDGED", target=f"session:{s['session_uuid']}").first()
    assert log is not None and log.organization_id == env["admin"]["org"].id
    details = json.loads(log.details)
    assert details["rules_version"] == flow.RULES_VERSION and details["acknowledged_at"]
    reg_id = db.query(models.CandidateRegistration).filter_by(attempt_session_uuid=s["session_uuid"]).first().id
    dossier = client.get(f"/api/admin/recruitment/candidates/{reg_id}/dossier", headers=h.auth(env["admin"]["token"])).json()
    assert dossier["session"]["rules_acknowledged_at"] == details["acknowledged_at"]


def test_acknowledgement_never_starts_the_clock_by_itself(db, env, clk):
    token, _ = fresh(env)
    clk.advance(1800)                                                     # half an hour on the instructions page
    s = h.start_ok(env["token"], token)
    assert s["state"]["overall_remaining_seconds"] == 3600 and s["state"]["section"]["remaining_seconds"] == 1200


# ------------------------------------------------------------------------------ the student formats reach the candidate
def test_candidate_receives_student_formatted_sections_without_secrets(db, env, clk):
    s = started(env)
    state = client.get(h.sess_url(s, "state"), headers=h.sh(s)).json()
    q = state["section"]["questions"][0]
    assert [o["key"] for o in q["options"]] == ["A", "B", "C", "D"] and "correct_key" not in q
    r = client.post(h.sess_url(s, "submit-aptitude"), headers=h.sh(s), json={"answers": h.correct_aptitude_answers(db, s["session_uuid"])})
    coding = r.json()["section"]["questions"][0]
    assert set(coding["starter_code"]) == {"python", "java"} and coding["input_format"] and coding["output_format"]
    assert all(set(t) >= {"input", "expected_output"} for t in coding["public_test_cases"])
    r = client.post(h.sess_url(s, "submit-coding"), headers=h.sh(s), json={"solutions": h.GOOD_SOLUTIONS})
    interview = r.json()["section"]["questions"]
    blob = json.dumps(interview) + json.dumps(client.get(h.sess_url(s, "state"), headers=h.sh(s)).json())
    assert all(set(x) == {"id", "category", "question"} for x in interview)
    for secret in ("evaluation_criteria", "expected_technical_concepts", "Technical accuracy", "hidden_test_cases", "correct_key"):
        assert secret not in blob


# ------------------------------------------------------------------------------ voice interview for public candidates
def _to_interview(db, env):
    s = started(env)
    assert client.post(h.sess_url(s, "submit-aptitude"), headers=h.sh(s), json={"answers": h.correct_aptitude_answers(db, s["session_uuid"])}).status_code == 200
    assert client.post(h.sess_url(s, "submit-coding"), headers=h.sh(s), json={"solutions": h.GOOD_SOLUTIONS}).status_code == 200
    return s


@pytest.fixture
def fake_voice(monkeypatch):
    seen = {}
    real = elevenlabs_service.build_voice_session

    def spy(**kw):
        seen.update(kw)
        return real(**kw)

    monkeypatch.setattr(elevenlabs_service, "build_voice_session", spy)
    return seen


def test_voice_init_defines_the_shared_voice_interviewer_within_the_section_limit(db, env, clk, fake_voice):
    s = _to_interview(db, env)
    clk.advance(300)
    r = client.post(h.sess_url(s, "voice-init"), headers=h.sh(s))
    assert r.status_code == 200
    body = r.json()
    assert body["voiceConfig"]["maxDurationSeconds"] == 1200 - 300 and "Test Candidate" in body["voiceConfig"]["firstMessage"]
    assert body["remaining_seconds"] == 900 and len(body["questions"]) == 5
    assert fake_voice["max_duration_seconds"] == 900 and fake_voice["candidate_name"] == "Test Candidate"
    blob = r.text + json.dumps(fake_voice["questions"])
    assert "evaluation_criteria" not in blob and "expected_technical_concepts" not in blob   # the rubric never reaches the browser or the voice model
    assert "system_prompt" not in r.text and "assistantId" not in r.text                     # the interview prompt stays on the server


def test_voice_init_is_gated_like_every_other_candidate_call(db, env, clk, fake_voice):
    s = started(env)
    assert client.post(h.sess_url(s, "voice-init"), headers=h.sh(s)).status_code == 403            # interview not unlocked yet
    assert client.post(h.sess_url(s, "voice-init")).status_code == 401                                # no capability
    assert client.post(h.sess_url(s, "voice-init"), headers={"X-Session-Token": "bad", "X-Session-Lease": s["session_lease"]}).status_code == 403
    other = started(env)
    assert client.post(h.sess_url(s, "voice-init"), headers=h.sh(other)).status_code == 403          # another candidate's capability
    s2 = _to_interview(db, env)
    clk.advance(21 * 60)
    late = client.post(h.sess_url(s2, "voice-init"), headers=h.sh(s2))
    assert late.status_code in (408, 409)                                                           # nothing is set up after the deadline


def test_voice_init_is_rate_limited_per_sitting(db, env, fake_voice):
    s = _to_interview(db, env)
    codes = [client.post(h.sess_url(s, "voice-init"), headers=h.sh(s)).status_code for _ in range(6)]
    assert codes[:4] == [200] * 4 and codes[4:] == [429, 429]            # every call rebuilds the interview definition


def _turn(s, **form):
    return client.post(h.sess_url(s, "voice-turn"), headers={k: v for k, v in h.sh(s).items() if k != "Content-Type"}, **form)


def test_voice_turn_speaks_the_opening_then_answers_a_recorded_reply(db, env, elevenlabs_http, monkeypatch):
    monkeypatch.setattr(gemini_client, "call_gemini_text", lambda prompt, system_prompt, temperature=0.1: "Thanks. What was the hardest part?")
    s = _to_interview(db, env)
    assert _turn(s, data={"opening": "true"}).status_code == 409                         # not initialised yet
    assert client.post(h.sess_url(s, "voice-init"), headers=h.sh(s)).status_code == 200
    opening = _turn(s, data={"opening": "true"})
    assert opening.status_code == 200 and opening.json()["audio_base64"] and "Test Candidate" in opening.json()["reply_text"]
    assert opening.json()["user_text"] == ""

    history = json.dumps([{"role": "ai", "text": opening.json()["reply_text"]}])
    r = _turn(s, data={"history": history, "opening": "false"}, files={"audio": ("answer.webm", b"RIFFfake", "audio/webm")})
    assert r.status_code == 200
    body = r.json()
    assert body["user_text"] == elevenlabs_http.transcript and body["reply_text"] and body["audio_base64"]
    stt_call = next(c for c in elevenlabs_http.calls if c["url"].endswith("/speech-to-text"))
    assert stt_call["headers"]["xi-api-key"] == "test-api-key-not-real"                   # the key is only ever sent from the server


def test_voice_turn_with_no_speech_keeps_listening_and_is_gated(db, env, elevenlabs_http):
    s = _to_interview(db, env)
    assert client.post(h.sess_url(s, "voice-init"), headers=h.sh(s)).status_code == 200
    elevenlabs_http.transcript = ""
    r = _turn(s, data={"history": "[]"}, files={"audio": ("answer.webm", b"RIFFfake", "audio/webm")})
    assert r.status_code == 200 and r.json()["user_text"] == "" and r.json()["audio_base64"] is None
    assert client.post(h.sess_url(s, "voice-turn")).status_code == 401                    # no capability


def test_voice_turn_hides_provider_failures(db, env, elevenlabs_http):
    s = _to_interview(db, env)
    assert client.post(h.sess_url(s, "voice-init"), headers=h.sh(s)).status_code == 200
    elevenlabs_http.fail_with = 500
    r = _turn(s, data={"opening": "true"})
    assert r.status_code == 503 and "upstream failure" not in r.text


def test_voice_interview_answers_and_transcript_are_evaluated_and_reported(db, env, monkeypatch, fake_voice):
    captured = {}

    def evaluator(questions, answers, role, jd_summary="", resume_summary="", transcript=None, call_gemini_fn=None):
        captured.update(questions=questions, answers=answers, transcript=transcript)
        return {"score": 72.0, "overall_score": 72.0, "summary": "solid", "evaluation_source": "ai", "technical_depth_score": 70.0,
                "communication_score": 74.0, "key_strengths": ["clear"], "key_areas_for_improvement": ["depth"],
                "question_evaluations": [{"question_id": i + 1, "category": "c", "question_text": q["question"], "score": 72.0,
                                          "status": "partially_correct", "explanation": "ok", "demonstrated_strengths": ["a"], "knowledge_gaps": ["b"]}
                                         for i, q in enumerate(questions)]}

    monkeypatch.setattr(interview_evaluation, "evaluate_five_technical_questions", evaluator)
    s = _to_interview(db, env)
    answers = [{"question_id": f"I{i}", "response": f"Spoken answer {i}", "follow_ups": [{"follow_up_question": "why?", "response": "because"}]} for i in range(1, 6)]
    transcript = [{"role": "ai", "text": "Question 1: ..."}, {"role": "user", "text": "Spoken answer 1"}]
    r = client.post(h.sess_url(s, "submit-interview"), headers=h.sh(s), json={"answers": answers, "transcript": transcript})
    assert r.status_code == 200 and r.json()["state"] == "COMPLETED"
    assert [a["response"] for a in captured["answers"]][:2] == ["Spoken answer 1", "Spoken answer 2"]
    assert captured["transcript"][1]["text"] == "Spoken answer 1"
    assert "evaluation_criteria" in captured["questions"][0]                                         # the rubric reached the evaluator, server-side
    row = h.session_row(db, s["session_uuid"])
    interview = row.final_report_data["sections"]["interview"]
    assert interview["score"] == 72.0 and interview["details"]["summary"] == "solid"
    assert interview["details"]["questions"][0]["response"] == "Spoken answer 1" and len(interview["details"]["transcript"]) == 2


def test_late_interview_work_is_not_accepted_after_the_deadline(db, env, clk):
    s = _to_interview(db, env)
    clk.advance(20 * 60 + 11)
    answers = [{"question_id": "I1", "response": "too late"}]
    late = client.post(h.sess_url(s, "submit-interview"), headers=h.sh(s), json={"answers": answers, "transcript": []})
    assert late.status_code == 408
    row = h.session_row(db, s["session_uuid"])
    saved = flow.get_rounds(db, row.id)["INTERVIEW"].submission_payload or {}
    assert "too late" not in json.dumps(saved)                                                   # the late text was not accepted


# ------------------------------------------------------------------------------ proctoring evidence
def test_proctoring_events_are_recorded_for_the_hiring_team_but_never_end_the_attempt(db, env):
    s = started(env)
    events = [{"type": "Tab switch", "strike": i, "timestamp": f"2026-03-02T09:0{i}:00Z", "evil": "<script>"} for i in range(1, 5)]
    r = client.put(h.sess_url(s, "draft"), headers=h.sh(s), json={"section": "aptitude", "payload": {}, "violations": events})
    assert r.status_code == 200
    row = h.session_row(db, s["session_uuid"])
    saved = flow.get_rounds(db, row.id)["APTITUDE"].proctoring_violations
    assert len(saved) == 4 and all(set(e) == {"type", "strike", "timestamp"} for e in saved)
    assert row.current_state == "APTITUDE_IN_PROGRESS"                                              # four strikes: still sitting
    r = client.post(h.sess_url(s, "submit-aptitude"), headers=h.sh(s), json={"answers": {}, "violations": events[:2]})
    assert r.status_code == 200
    row = h.session_row(db, s["session_uuid"])
    assert row.final_report_data["sections"]["aptitude"]["proctoring"]["count"] == 2
    reg_id = db.query(models.CandidateRegistration).filter_by(attempt_session_uuid=s["session_uuid"]).first().id
    dossier = client.get(f"/api/admin/recruitment/candidates/{reg_id}/dossier", headers=h.auth(env["admin"]["token"])).json()
    assert dossier["report"]["sections"]["aptitude"]["proctoring"]["count"] == 2


# ------------------------------------------------------------------------------ parity with the Student Platform
def _student_session_from_blueprint(db, data, blueprint):
    """A Student Platform attempt whose rounds hold the SAME adapted blueprint content as a recruitment attempt."""
    session = rs.create_student_session(db=db, student_profile=data["student_profile"], target_role="Backend Engineer", target_company="Acme")
    payloads = engine.adapt_blueprint(blueprint)
    for r in db.query(models.RoleReadyRoundAttempt).filter_by(session_id=session.id):
        client_payload, keys = payloads[r.round_type]
        r.questions_payload, r.server_keys_payload = client_payload, keys
    db.commit()
    return session


def test_both_workflows_score_identical_answers_identically(db, env, db_session, setup_test_data, monkeypatch):
    """The same answers, code and interview evaluation produce the same section percentages and the same overall score in both workflows."""
    from services import gemini_mock_fixtures, jd_blueprint_service
    blueprint = jd_blueprint_service.validate_blueprint(gemini_mock_fixtures.sample_blueprint()).model_dump()

    def evaluator(questions, answers, role, jd_summary="", resume_summary="", transcript=None, call_gemini_fn=None):
        return {"score": 90.0, "summary": "ok", "evaluation_source": "ai", "question_evaluations": []}

    monkeypatch.setattr(interview_evaluation, "evaluate_five_technical_questions", evaluator)
    monkeypatch.setattr(rs, "evaluate_five_technical_questions", evaluator)
    answers_9_of_15 = None

    # --- recruitment candidate (public capability API)
    s = started(env)
    keys = h.correct_aptitude_answers(db, s["session_uuid"])
    answers_9_of_15 = dict(list(keys.items())[:9])                                                       # 9 / 15 = 60.0 %
    half_wrong = {"C1": h.GOOD_SOLUTIONS["C1"], "C2": {"language": "python", "code": h.program("def solve(s):\n    return s\n")}}
    assert client.post(h.sess_url(s, "submit-aptitude"), headers=h.sh(s), json={"answers": answers_9_of_15}).status_code == 200
    assert client.post(h.sess_url(s, "submit-coding"), headers=h.sh(s), json={"solutions": half_wrong}).status_code == 200
    interview = [{"question_id": f"I{i}", "response": f"answer {i}"} for i in range(1, 6)]
    assert client.post(h.sess_url(s, "submit-interview"), headers=h.sh(s), json={"answers": interview, "transcript": []}).status_code == 200
    rec = h.session_row(db, s["session_uuid"])

    # --- student, same content, student endpoints
    sess = _student_session_from_blueprint(db_session, setup_test_data, blueprint)
    hdr = setup_test_data["auth_headers"]
    base = f"/api/roleready/session/{sess.session_uuid}"
    client.post(f"{base}/start-aptitude", headers=hdr)
    assert client.post(f"{base}/submit-aptitude", headers=hdr, json={"answers": answers_9_of_15}).status_code == 200
    client.post(f"{base}/start-coding", headers=hdr)
    assert client.post(f"{base}/submit-coding", headers=hdr, json={"solutions": half_wrong}).status_code == 200
    client.post(f"{base}/start-interview", headers=hdr)
    done = client.post(f"{base}/submit-interview", headers=hdr, json={"answers": interview})
    assert done.status_code == 200
    db_session.expire_all()
    stu = db_session.query(models.RoleReadySession).filter_by(id=sess.id).first()

    assert (rec.aptitude_score, rec.coding_score, rec.interview_score) == (stu.aptitude_score, stu.coding_score, stu.interview_score)
    assert rec.aptitude_score == 60.0 and rec.interview_score == 90.0 and 0.0 < rec.coding_score < 100.0
    assert rec.overall_readiness_score == stu.overall_readiness_score == policy.overall_score(60.0, rec.coding_score, 90.0)
    assert rec.final_report_data["scoring_model"] == stu.final_report_data["scoring_model"] == "equal_v1"


# ------------------------------------------------------------------------------ isolation between the two workflows
def test_student_session_is_not_reachable_through_the_public_candidate_api(db, env, db_session, setup_test_data):
    sess = rs.create_student_session(db=db_session, student_profile=setup_test_data["student_profile"], target_role="Dev", target_company="X")
    hdr = setup_test_data["auth_headers"]
    for method, path in (("get", "state"), ("post", "heartbeat"), ("post", "voice-init")):
        r = getattr(client, method)(f"/api/public/assessment/session/{sess.session_uuid}/{path}", headers={**hdr, "X-Session-Token": "x", "X-Session-Lease": "y"})
        assert r.status_code == 404, (path, r.status_code)


def test_public_candidates_cannot_use_student_endpoints(db, env):
    s = started(env)
    for headers in ({"X-Session-Token": s["session_token"]}, {"X-Invitation-Token": s["session_token"]}, {"Authorization": s["session_token"]}):
        r = client.get(f"/api/roleready/session/{s['session_uuid']}", headers=headers)
        assert r.status_code in (401, 403, 404)
    assert client.put(f"/api/roleready/session/{s['session_uuid']}/draft", headers={"X-Invitation-Token": s["session_token"]},
                      json={"section": "aptitude", "payload": {}}).status_code in (401, 403, 404)
