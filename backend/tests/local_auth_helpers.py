"""Shared helpers for tests that need real local-auth logins (cookie sessions) instead of the removed Clerk token exchange."""
import models
import utils
from fastapi.testclient import TestClient
from main import app
from services import local_auth

TEST_PASSWORD = "Test-Passw0rd-Local1!"


def new_client(**kw):
    return TestClient(app, base_url="http://testserver", **kw)


def reset_login_limits():
    local_auth.login_tracker.reset()


def ensure_org(db, slug="roleready-students", name="RoleReady Student Assessment Hub"):
    org = db.query(models.Organization).filter(models.Organization.slug == slug).first()
    if not org:
        org = models.Organization(name=name, slug=slug, status="active")
        db.add(org)
        db.commit()
        db.refresh(org)
    return org


def ensure_user(db, email, role, org=None, password=TEST_PASSWORD, active=True, admin_membership=False, student_profile=False, full_name=None):
    """Creates or resets a user with a known bcrypt password. Returns the row."""
    user = db.query(models.User).filter(models.User.email == email).first()
    if user is None:
        user = models.User(email=email, role=role, hashed_password=utils.get_password_hash(password),
                           is_active=active, organization_id=org.id if org else None)
        db.add(user)
    else:
        user.role = role
        user.hashed_password = utils.get_password_hash(password)
        user.is_active = active
        if org is not None:
            user.organization_id = org.id
    db.commit()
    db.refresh(user)
    if admin_membership and org is not None:
        member = db.query(models.OrganizationMember).filter_by(user_id=user.id, organization_id=org.id).first()
        if member is None:
            db.add(models.OrganizationMember(organization_id=org.id, user_id=user.id, role="ADMIN", status="active"))
        else:
            member.status = "active"
        db.commit()
    if student_profile:
        prof = db.query(models.StudentProfile).filter_by(user_id=user.id).first()
        if prof is None:
            db.add(models.StudentProfile(user_id=user.id, organization_id=org.id if org else None, email=email,
                                         full_name=full_name or email.split("@")[0], target_role="Software Engineer"))
            db.commit()
    return user


def login(email, password=TEST_PASSWORD, expect=200):
    """(client with the session cookie jar, response). Asserts the status when `expect` is given."""
    reset_login_limits()
    c = new_client()
    res = c.post("/api/auth/login/", json={"email": email, "password": password})
    if expect is not None:
        assert res.status_code == expect, f"login {email}: {res.status_code} {res.text}"
    return c, res
