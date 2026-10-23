import pytest
from fastapi.testclient import TestClient
from main import app
import models, database, utils
from tests.recruitment_helpers import new_session as rh_new_session

client = TestClient(app)

@pytest.fixture(scope="module")
def db_session():
    db = rh_new_session()
    yield db
    db.close()

@pytest.fixture(scope="module")
def setup_auth_test_data(db_session):
    # Create or fetch test organization
    org = db_session.query(models.Organization).filter_by(slug="auth-canonical-org").first()
    if not org:
        org = models.Organization(name="Canonical Auth Org", slug="auth-canonical-org", status="active")
        db_session.add(org)
        db_session.commit()
        db_session.refresh(org)

    # 1. Student User
    student_user = db_session.query(models.User).filter_by(email="student.guard@test.com").first()
    if not student_user:
        student_user = models.User(
            email="student.guard@test.com",
            hashed_password=utils.get_password_hash("password123"),
            role=models.UserRole.STUDENT,
            organization_id=org.id,
            is_active=True
        )
        db_session.add(student_user)
        db_session.commit()
        db_session.refresh(student_user)

    # 2. Org Admin User
    admin_user = db_session.query(models.User).filter_by(email="admin.canonical@test.com").first()
    if not admin_user:
        admin_user = models.User(
            email="admin.canonical@test.com",
            hashed_password=utils.get_password_hash("password123"),
            role=models.UserRole.ORGANIZATION_ADMIN,
            organization_id=org.id,
            is_active=True
        )
        db_session.add(admin_user)
        db_session.commit()
        db_session.refresh(admin_user)

    # Org member record for admin
    member = db_session.query(models.OrganizationMember).filter_by(user_id=admin_user.id).first()
    if not member:
        member = models.OrganizationMember(
            organization_id=org.id,
            user_id=admin_user.id,
            role="ORGANIZATION_ADMIN",
            status="active"
        )
        db_session.add(member)
        db_session.commit()

    # 3. Create a candidate in this organization
    cand = db_session.query(models.Candidate).filter_by(email="cand.canonical@test.com").first()
    if not cand:
        cand = models.Candidate(
            name="Candidate Canonical",
            email="cand.canonical@test.com",
            role="Software Engineer",
            organization_id=org.id,
            created_by=admin_user.id
        )
        db_session.add(cand)
        db_session.commit()
        db_session.refresh(cand)

    student_token = utils.create_access_token(data={"sub": student_user.email, "role": student_user.role})
    admin_token = utils.create_access_token(data={"sub": admin_user.email, "role": admin_user.role})

    return {
        "org": org,
        "student_user": student_user,
        "admin_user": admin_user,
        "student_token": student_token,
        "admin_token": admin_token,
        "candidate": cand
    }

def test_student_cannot_update_settings(setup_auth_test_data):
    token = setup_auth_test_data["student_token"]
    res = client.put(
        "/api/settings/",
        headers={"Authorization": f"Bearer {token}"},
        json={"config": {"security": {"block_copy_paste": False}}}
    )
    assert res.status_code == 403, f"Expected 403 Forbidden for student on settings update, got {res.status_code}"

def test_admin_can_update_settings(setup_auth_test_data):
    token = setup_auth_test_data["admin_token"]
    res = client.put(
        "/api/settings/",
        headers={"Authorization": f"Bearer {token}"},
        json={"config": {"security": {"block_copy_paste": True}}}
    )
    assert res.status_code == 200, f"Expected 200 OK for admin on settings update, got {res.status_code}"

def test_student_cannot_modify_candidates(setup_auth_test_data):
    token = setup_auth_test_data["student_token"]
    cand_id = setup_auth_test_data["candidate"].id

    # Test PATCH candidate
    patch_res = client.patch(
        f"/api/resume/candidates/{cand_id}/",
        headers={"Authorization": f"Bearer {token}"},
        json={"status": "Rejected"}
    )
    assert patch_res.status_code == 403, f"Expected 403 on PATCH candidate, got {patch_res.status_code}"

    # Test DELETE candidate
    del_res = client.delete(
        f"/api/resume/candidates/{cand_id}/",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert del_res.status_code == 403, f"Expected 403 on DELETE candidate, got {del_res.status_code}"

    # Test Bulk Update candidate
    bulk_res = client.post(
        "/api/resume/candidates/bulk-update/",
        headers={"Authorization": f"Bearer {token}"},
        json={"candidate_ids": [cand_id], "stage": "Offer Sent"}
    )
    assert bulk_res.status_code == 403, f"Expected 403 on bulk update candidate, got {bulk_res.status_code}"


# ==============================================================================
# Canonical admin authorization + request-scoped tenant resolution (plan Task 2)
# ==============================================================================
from tests import recruitment_helpers as rh


@pytest.fixture(scope="module")
def personas(db_session):
    a = rh.make_admin(db_session)
    b = rh.make_admin(db_session)
    hr = rh.make_admin(db_session, org=a["org"], member_role="HR")
    recruiter = rh.make_admin(db_session, org=a["org"], member_role="RECRUITER", user_role=models.UserRole.HR)

    # multi-org admin: active member of A (owner) and B (HR), no persistent anchor
    multi = rh.make_admin(db_session, org=a["org"], member_role="ORGANIZATION_ADMIN")
    db_session.add(models.OrganizationMember(organization_id=b["org"].id, user_id=multi["user"].id, role="HR", status="active"))
    multi["user"].organization_id = None
    db_session.commit()

    # multi-org admin WITH a persistent anchor
    anchored = rh.make_admin(db_session, org=a["org"])
    db_session.add(models.OrganizationMember(organization_id=b["org"].id, user_id=anchored["user"].id, role="ORGANIZATION_ADMIN", status="active"))
    db_session.commit()

    inactive_user = rh.make_admin(db_session, org=a["org"], active=False)
    inactive_member = rh.make_admin(db_session, org=a["org"])
    inactive_member["member"].status = "deactivated"
    db_session.commit()

    candidate_role = rh.make_admin(db_session, org=a["org"], user_role=models.UserRole.CANDIDATE)
    unassigned = models.User(email=f"unassigned.{rh.new_tag()}@rwtest.com", hashed_password="x", role=models.UserRole.HR, is_active=True)
    db_session.add(unassigned)
    db_session.commit()
    unassigned_token = utils.create_access_token(data={"sub": unassigned.email, "role": unassigned.role})

    platform = models.User(email=f"platform.{rh.new_tag()}@rwtest.com", hashed_password="x", role=models.UserRole.PLATFORM_ADMIN, is_active=True)
    db_session.add(platform)
    db_session.commit()
    platform_token = utils.create_access_token(data={"sub": platform.email, "role": platform.role})

    dead_org = models.Organization(name="Dead Org", slug=f"dead-{rh.new_tag()}", status="deactivated")
    db_session.add(dead_org)
    db_session.commit()
    dead_admin = rh.make_admin(db_session, org=dead_org)

    yield dict(a=a, b=b, hr=hr, recruiter=recruiter, multi=multi, anchored=anchored, inactive_user=inactive_user,
               inactive_member=inactive_member, candidate=candidate_role, unassigned_token=unassigned_token,
               platform_token=platform_token, platform=platform, dead=dead_admin, dead_org=dead_org)
    rh.cleanup_orgs(db_session, [a["org"].id, b["org"].id, dead_org.id])
    db_session.query(models.GlobalSettings).filter(models.GlobalSettings.created_by.in_([unassigned.id, platform.id])).delete(synchronize_session=False)
    db_session.query(models.User).filter(models.User.id.in_([unassigned.id, platform.id])).delete(synchronize_session=False)
    db_session.commit()


ADMIN_LIST = "/api/admin/job-roles/"


def test_student_blocked_from_admin_endpoints(setup_auth_test_data):
    token = setup_auth_test_data["student_token"]
    for method, path in (("get", ADMIN_LIST), ("get", "/api/admin/recruitment/overview-stats"), ("get", "/api/admin/recruitment/candidates")):
        assert getattr(client, method)(path, headers=rh.auth(token)).status_code == 403


def test_candidate_blocked_from_admin_endpoints(personas):
    assert client.get(ADMIN_LIST, headers=rh.auth(personas["candidate"]["token"])).status_code == 403
    assert client.get("/api/admin/recruitment/candidates", headers=rh.auth(personas["candidate"]["token"])).status_code == 403


def test_inactive_admin_blocked(personas):
    assert client.get(ADMIN_LIST, headers=rh.auth(personas["inactive_user"]["token"])).status_code == 403
    assert client.get(ADMIN_LIST, headers=rh.auth(personas["inactive_member"]["token"])).status_code == 403


def test_unassigned_user_and_deactivated_org_blocked(personas):
    assert client.get(ADMIN_LIST, headers=rh.auth(personas["unassigned_token"])).status_code == 403
    assert client.get(ADMIN_LIST, headers=rh.auth(personas["dead"]["token"])).status_code == 403


def test_unauthenticated_gets_401():
    assert client.get(ADMIN_LIST).status_code == 401
    assert client.get(ADMIN_LIST, headers={"Authorization": "Bearer garbage"}).status_code == 401


def test_hr_and_recruiter_authorized_but_not_org_admin_endpoints(personas):
    for who in ("hr", "recruiter"):
        assert client.get(ADMIN_LIST, headers=rh.auth(personas[who]["token"])).status_code == 200
        assert client.get("/api/admin/recruitment/overview-stats", headers=rh.auth(personas[who]["token"])).status_code == 200
        r = client.put("/api/settings/", headers=rh.auth(personas[who]["token"]), json={"config": {"security": {}}})
        assert r.status_code == 403 and "Organization administrator" in r.json()["detail"]


def test_multi_org_admin_requires_header(personas):
    r = client.get(ADMIN_LIST, headers=rh.auth(personas["multi"]["token"]))
    assert r.status_code == 400 and "X-Organization-Id" in r.json()["detail"]
    for path in ("/api/admin/recruitment/overview-stats", "/api/admin/recruitment/candidates"):
        assert client.get(path, headers=rh.auth(personas["multi"]["token"])).status_code == 400


def test_multi_org_admin_with_valid_header(personas, db_session):
    a_org, b_org = personas["a"]["org"].id, personas["b"]["org"].id
    created = client.post(ADMIN_LIST, headers=rh.auth(personas["multi"]["token"], b_org),
                          json={"title": "Header Scoped", "description": rh.JD_TEXT})
    assert created.status_code == 201
    db_session.expire_all()
    assert db_session.query(models.JobDescription).filter_by(id=created.json()["id"]).first().organization_id == b_org
    in_a = client.get(ADMIN_LIST, headers=rh.auth(personas["multi"]["token"], a_org)).json()
    in_b = client.get(ADMIN_LIST, headers=rh.auth(personas["multi"]["token"], b_org)).json()
    assert created.json()["id"] in {j["id"] for j in in_b} and created.json()["id"] not in {j["id"] for j in in_a}


def test_anchor_resolves_multi_membership_without_header(personas):
    # user.organization_id matches one of the active memberships -> unambiguous
    assert client.get(ADMIN_LIST, headers=rh.auth(personas["anchored"]["token"])).status_code == 200


def test_header_for_foreign_org_forbidden(personas):
    r = client.get(ADMIN_LIST, headers=rh.auth(personas["a"]["token"], personas["b"]["org"].id))
    assert r.status_code == 403 and "not an active member" in r.json()["detail"]
    assert client.get(ADMIN_LIST, headers=rh.auth(personas["a"]["token"], 99999999)).status_code == 403
    bad = {"Authorization": f"Bearer {personas['a']['token']}", "X-Organization-Id": "abc"}
    assert client.get(ADMIN_LIST, headers=bad).status_code == 400


def test_tenant_switching_does_not_mutate_user_db_record(personas, db_session):
    user_id = personas["multi"]["user"].id
    before = db_session.query(models.User.organization_id).filter_by(id=user_id).scalar()
    assert before is None
    for org in (personas["a"]["org"].id, personas["b"]["org"].id, personas["a"]["org"].id):
        assert client.get(ADMIN_LIST, headers=rh.auth(personas["multi"]["token"], org)).status_code == 200
    db_session.expire_all()
    assert db_session.query(models.User.organization_id).filter_by(id=user_id).scalar() is None


def test_admin_authorized_on_admin_endpoints(personas):
    assert client.get(ADMIN_LIST, headers=rh.auth(personas["a"]["token"])).status_code == 200


def test_cross_tenant_access_blocked(personas):
    job = rh.create_job(personas["b"])
    assert job["id"] not in {j["id"] for j in client.get(ADMIN_LIST, headers=rh.auth(personas["a"]["token"])).json()}
    assert client.get(f"{ADMIN_LIST}{job['id']}", headers=rh.auth(personas["a"]["token"])).status_code == 404


def test_org_admin_settings_scoped_to_header_tenant(personas):
    b_org = personas["b"]["org"].id
    r = client.put("/api/settings/", headers=rh.auth(personas["multi"]["token"], personas["a"]["org"].id),
                   json={"config": {"security": {"block_copy_paste": True}}})
    assert r.status_code == 200
    # multi's membership in B is HR: settings for B are refused although A is allowed
    assert client.put("/api/settings/", headers=rh.auth(personas["multi"]["token"], b_org), json={"config": {"security": {}}}).status_code == 403
    assert client.put("/api/settings/", headers=rh.auth(personas["multi"]["token"]), json={"config": {"security": {}}}).status_code == 400


def test_platform_admin_needs_explicit_tenant_and_is_not_an_org_member(personas):
    r = client.get(ADMIN_LIST, headers=rh.auth(personas["platform_token"]))
    assert r.status_code == 400 and "target organization" in r.json()["detail"]
    assert client.get(ADMIN_LIST, headers=rh.auth(personas["platform_token"], personas["a"]["org"].id)).status_code == 200
    assert client.get(ADMIN_LIST, headers=rh.auth(personas["platform_token"], 99999999)).status_code == 404
    assert client.put("/api/settings/", headers=rh.auth(personas["platform_token"], personas["a"]["org"].id),
                      json={"config": {"security": {}}}).status_code == 200


def test_standard_admins_never_reach_platform_only_endpoints(personas):
    body = {"outage_start_utc": "2026-10-22T01:00:00Z", "outage_resolved_utc": "2026-10-22T01:10:00Z"}
    for who in ("a", "hr", "recruiter", "multi"):
        r = client.post("/api/admin/recruitment/incidents", headers=rh.auth(personas[who]["token"], personas["a"]["org"].id), json=body)
        assert r.status_code == 403, who
