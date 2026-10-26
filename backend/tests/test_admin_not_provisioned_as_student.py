"""
Regression: the admin navbar used to call the student assessment-history endpoint with the admin's own token. That endpoint
auto-provisioned a StudentProfile, after which /api/auth/me reported the admin as a STUDENT and the admin workspace
refused to load ("Student Account Detected").
"""
import database
import models
from tests import recruitment_helpers as h

client = h.client


def test_hiring_admin_never_gets_a_student_profile_and_stays_an_admin():
    db = database.SessionLocal()
    try:
        admin = h.make_admin(db, tag=h.new_tag())
        for path in ("/api/roleready/student/assessments", "/api/roleready/student/history"):
            res = client.get(path, headers=h.auth(admin["token"]))
            assert res.status_code == 403, path
        db.expire_all()
        assert db.query(models.StudentProfile).filter(models.StudentProfile.user_id == admin["user"].id).count() == 0
        me = client.get("/api/auth/me", headers=h.auth(admin["token"])).json()
        assert me["role"] in ("ADMIN", "ORGANIZATION_ADMIN")
        assert client.get("/api/admin/recruitment/overview-stats", headers=h.auth(admin["token"])).status_code == 200
    finally:
        db.close()


def test_students_still_get_their_profile_provisioned():
    db = database.SessionLocal()
    try:
        tag = h.new_tag()
        org = models.Organization(name=f"S Org {tag}", slug=f"s-org-{tag}", status="active")
        db.add(org)
        db.commit()
        user = models.User(email=f"stu.{tag}@rwtest.com", hashed_password="x", role=models.UserRole.STUDENT, organization_id=org.id)
        db.add(user)
        db.commit()
        import utils
        token = utils.create_access_token(data={"sub": user.email, "role": user.role})
        assert client.get("/api/roleready/student/assessments", headers=h.auth(token)).status_code == 200
        assert db.query(models.StudentProfile).filter(models.StudentProfile.user_id == user.id).count() == 1
    finally:
        db.close()
