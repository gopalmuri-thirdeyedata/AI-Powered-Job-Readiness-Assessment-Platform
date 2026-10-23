"""
The legacy invitation "Assessment Tracking" list must be tenant scoped and must not mix in shared-link recruitment attempts.

Regression: org-less student sessions (organization_id IS NULL) used to be returned to EVERY organization's admin, which
inflated the Assessment Tracking badge (e.g. 52) while the recruitment overview correctly showed 0 registrations.
"""
import pytest

import database
import models
from services import roleready_service
from tests import recruitment_helpers as h


@pytest.fixture()
def db():
    session = database.SessionLocal()
    yield session
    session.close()


def _student(db, org, tag, name):
    user = models.User(email=f"stu.{tag}@rwtest.com", hashed_password="x", role=models.UserRole.STUDENT, organization_id=org.id if org else None)
    db.add(user)
    db.commit()
    db.refresh(user)
    profile = models.StudentProfile(user_id=user.id, organization_id=org.id if org else None, full_name=name, email=user.email, target_role="Dev")
    db.add(profile)
    db.commit()
    db.refresh(profile)
    return profile


def _session(db, profile, uuid, org_id=None, workflow="SELF_ASSESSMENT"):
    s = models.RoleReadySession(session_uuid=uuid, workflow_type=workflow, organization_id=org_id, student_profile_id=profile.id, target_role="Dev")
    db.add(s)
    db.commit()
    return s


def test_orgless_sessions_only_reach_the_owning_tenant(db):
    tag = h.new_tag()
    a = h.make_admin(db, tag=f"a{tag}")
    b = h.make_admin(db, tag=f"b{tag}")
    stu_a = _student(db, a["org"], f"a{tag}", "Alice (org A)")
    stu_b = _student(db, b["org"], f"b{tag}", "Bob (org B)")
    stu_nobody = _student(db, None, f"n{tag}", "Nobody (no org)")
    _session(db, stu_a, f"sa-{tag}")                           # org-less session owned by org A's student
    _session(db, stu_b, f"sb-{tag}")                           # org-less session owned by org B's student
    _session(db, stu_nobody, f"sn-{tag}")                      # org-less session owned by nobody's organization
    _session(db, stu_a, f"sr-{tag}", org_id=a["org"].id, workflow="RECRUITMENT_ASSESSMENT")  # shared-link attempt: has its own roster

    names_a = {row["name"] for row in roleready_service.get_admin_tracking_data(db, a["org"].id)}
    names_b = {row["name"] for row in roleready_service.get_admin_tracking_data(db, b["org"].id)}

    assert "Alice (org A)" in names_a
    assert "Bob (org B)" not in names_a and "Nobody (no org)" not in names_a, "other tenants' / org-less students never leak in"
    assert "Bob (org B)" in names_b and "Alice (org A)" not in names_b
    assert len([r for r in roleready_service.get_admin_tracking_data(db, a["org"].id) if r["session_uuid"] == f"sr-{tag}"]) == 0, \
        "shared-link recruitment attempts stay out of the legacy invitation tracking"
