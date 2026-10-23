"""Historical scores are audited, never rewritten (backend/audit_assessment_scoring.py is read-only)."""
import uuid

import models
from audit_assessment_scoring import build_audit
from services import assessment_policy as policy
from tests.test_roleready_pipeline import db_session, setup_test_data  # noqa: F401  (fixtures)


def _row(db, data, **kw):
    s = models.RoleReadySession(
        session_uuid=f"audit-{uuid.uuid4().hex[:10]}", workflow_type="SELF_ASSESSMENT", student_profile_id=data["student_profile"].id,
        organization_id=data["student_profile"].organization_id, target_role="Dev", **kw)
    db.add(s)
    db.commit()
    return s


def test_audit_reports_legacy_differences_without_changing_anything(db_session, setup_test_data):
    legacy = _row(db_session, setup_test_data, current_state="COMPLETED", aptitude_score=80.0, coding_score=60.0, interview_score=90.0,
                  overall_readiness_score=74.5, final_report_data={"completion_status": "COMPLETED"})                    # 25/40/35
    stamped = _row(db_session, setup_test_data, current_state="COMPLETED", aptitude_score=80.0, coding_score=60.0, interview_score=90.0,
                   overall_readiness_score=76.67, final_report_data={"scoring_model": "equal_v1"})
    dq = _row(db_session, setup_test_data, current_state="COMPLETED", aptitude_score=50.0, coding_score=50.0, interview_score=50.0,
              overall_readiness_score=0.0, final_report_data={"is_disqualified": True})
    open_ = _row(db_session, setup_test_data, current_state="CODING_IN_PROGRESS", aptitude_score=90.0, overall_readiness_score=0.0)
    before = {s.id: (s.overall_readiness_score, s.final_report_data) for s in (legacy, stamped, dq, open_)}

    result = build_audit(db_session)
    by_uuid = {r["session_uuid"]: r for r in result["rows"]}

    assert by_uuid[legacy.session_uuid]["scoring_model"] == policy.LEGACY_SCORING_MODEL
    assert by_uuid[legacy.session_uuid]["recorded_overall"] == 74.5 and by_uuid[legacy.session_uuid]["equal_weight_overall"] == 76.67
    assert by_uuid[legacy.session_uuid]["difference"] == 2.17
    assert by_uuid[stamped.session_uuid]["difference"] == 0.0 and by_uuid[stamped.session_uuid]["scoring_model"] == "equal_v1"
    assert dq.session_uuid not in by_uuid and open_.session_uuid not in by_uuid          # forfeited and incomplete attempts are not compared
    assert result["summary"]["legacy_would_change"] >= 1 and result["summary"]["disqualified"] >= 1

    db_session.expire_all()
    for s in (legacy, stamped, dq, open_):                                               # nothing was rewritten
        db_session.refresh(s)
        assert (s.overall_readiness_score, s.final_report_data) == before[s.id]
