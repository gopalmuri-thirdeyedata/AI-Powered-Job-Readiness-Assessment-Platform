"""
Interview evaluation runs in the background: submit returns immediately, the report reports
PROCESSING -> READY, double submits are safe, and a failure is recoverable (FAILED -> retry -> READY).
Uses an isolated database file per test (NOT a shared in-memory connection: the worker thread and the polling test thread
must have separate connections, otherwise closing the polling session rolls back the worker's uncommitted writes); the AI
call is faked.
"""
import time

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import database
import models
from services import roleready_service as rs

QS = [{"id": i, "category": "Tech", "question": f"q{i}"} for i in range(1, 6)]
ANSWERS = [{"question_id": i, "response": "I would add caching and indexes."} for i in range(1, 6)]


@pytest.fixture
def env(monkeypatch, tmp_path):
    engine = create_engine(f"sqlite:///{(tmp_path / 'bg.db').as_posix()}", connect_args={"check_same_thread": False, "timeout": 30})
    models.Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    monkeypatch.setattr(database, "SessionLocal", Session)  # the worker thread opens its own session
    monkeypatch.setattr(rs, "BACKGROUND_INTERVIEW_EVALUATION", True)
    # Fake the scorer itself (slow, like the real AI call) so this test only exercises the background flow
    monkeypatch.setattr(rs, "evaluate_five_technical_questions",
                        lambda **k: (time.sleep(0.4), {"score": 77, "summary": "ok", "question_evaluations": []})[1])
    db = Session()
    prof = models.StudentProfile(user_id=1, full_name="T", email="t@x.com")
    db.add(prof)
    db.commit()
    yield Session, db, prof
    db.close()
    engine.dispose()


def _new_session(db, prof, uuid):
    s = models.RoleReadySession(session_uuid=uuid, student_profile_id=prof.id, target_role="Dev",
                                current_state="INTERVIEW_IN_PROGRESS", aptitude_score=60, coding_score=50,
                                extracted_jd_data={"required_skills": ["Python"]})
    db.add(s)
    db.commit()
    db.add(models.RoleReadyRoundAttempt(session_id=s.id, round_type="INTERVIEW", round_order=3, status="IN_PROGRESS",
                                        time_limit_minutes=15, questions_payload=QS, started_at=rs.datetime.utcnow()))
    db.commit()
    return s


def _status(Session, uuid):
    d = Session()
    try:
        s = d.query(models.RoleReadySession).filter_by(session_uuid=uuid).first()
        return rs.get_student_report(d, s)["report_status"]
    finally:
        d.close()


def _wait_for(Session, uuid, want, timeout=8):
    end = time.time() + timeout
    while time.time() < end:
        if _status(Session, uuid) == want:
            return True
        time.sleep(0.1)
    return False


def test_submit_returns_immediately_then_report_becomes_ready(env):
    Session, db, prof = env
    s = _new_session(db, prof, "bg1")
    t = time.time()
    res = rs.start_interview_evaluation(db, s, {"answers": ANSWERS, "transcript": []}, 120, [])
    assert time.time() - t < 0.3 and res["status"] == "PROCESSING"
    assert _status(Session, "bg1") == "PROCESSING"
    rs.start_interview_evaluation(db, s, {"answers": ANSWERS, "transcript": []}, 120, [])  # double click
    assert _wait_for(Session, "bg1", "READY")
    d = Session()
    done = d.query(models.RoleReadySession).filter_by(session_uuid="bg1").first()
    assert done.current_state == models.RoleReadySessionState.COMPLETED
    assert done.interview_score == 77.0
    assert done.overall_readiness_score == 62.33  # equal weight: (60 + 50 + 77) / 3


def test_failed_evaluation_is_recoverable(env, monkeypatch):
    Session, db, prof = env
    s = _new_session(db, prof, "bg2")
    real = rs.submit_interview_round
    monkeypatch.setattr(rs, "submit_interview_round", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("db down")))
    rs.start_interview_evaluation(db, s, {"answers": ANSWERS, "transcript": []}, 10, [])
    assert _wait_for(Session, "bg2", "FAILED")
    monkeypatch.setattr(rs, "submit_interview_round", real)
    d = Session()
    x = d.query(models.RoleReadySession).filter_by(session_uuid="bg2").first()
    assert rs.retry_interview_evaluation(d, x)["report_status"] == "PROCESSING"
    assert _wait_for(Session, "bg2", "READY")


def test_expiry_does_not_race_a_running_evaluation(env):
    Session, db, prof = env
    s = _new_session(db, prof, "bg3")
    rnd = db.query(models.RoleReadyRoundAttempt).filter_by(session_id=s.id).first()
    rnd.status = "EVALUATING"
    rnd.started_at = rs.datetime.utcnow() - rs.timedelta(minutes=60)  # deadline long past
    db.commit()
    assert rs.finalize_expired_round(db, s) is False
