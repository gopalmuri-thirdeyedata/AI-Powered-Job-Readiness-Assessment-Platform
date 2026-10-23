"""Deterministic role selection when one user has several active membership rows in the same organization."""
import pytest
from fastapi.testclient import TestClient

import models
from main import app
from tests import recruitment_helpers as rh

client = TestClient(app)
ADMIN_LIST = "/api/admin/job-roles/"
OWNER_ONLY = ("put", "/api/settings/")


@pytest.fixture(scope="module")
def db_session():
    db = rh.new_session()
    yield db
    db.close()


@pytest.fixture(scope="module")
def orgs(db_session):
    a = rh.make_admin(db_session)
    b = rh.make_admin(db_session)
    yield dict(a=a, b=b)
    rh.cleanup_orgs(db_session, [a["org"].id, b["org"].id])


def _user_with_rows(db, org, roles, statuses=None):
    """New user anchored to `org` with one membership row per role, inserted in the given order."""
    persona = rh.make_admin(db, org=org, member_role=roles[0])
    persona["member"].status = (statuses or ["active"] * len(roles))[0]
    for i, role in enumerate(roles[1:], start=1):
        db.add(models.OrganizationMember(organization_id=org.id, user_id=persona["user"].id, role=role,
                                         status=(statuses or ["active"] * len(roles))[i]))
    db.commit()
    return persona


def _owner_probe(token, org_id=None):
    return client.put("/api/settings/", headers=rh.auth(token, org_id), json={"config": {"security": {}}}).status_code


@pytest.mark.parametrize("roles", [["HR", "ORGANIZATION_ADMIN"], ["ORGANIZATION_ADMIN", "HR"]], ids=["hr_row_first", "owner_row_first"])
def test_duplicate_rows_resolve_to_owner_independent_of_row_order(db_session, orgs, roles):
    p = _user_with_rows(db_session, orgs["a"]["org"], roles)
    assert client.get(ADMIN_LIST, headers=rh.auth(p["token"])).status_code == 200
    assert _owner_probe(p["token"]) != 403
    me = client.get("/api/auth/me", headers=rh.auth(p["token"]))
    assert me.status_code == 200 and me.json()["role"] == "ORGANIZATION_ADMIN"
    assert me.json()["organization_id"] == orgs["a"]["org"].id


def test_duplicate_non_owner_rows_never_become_owner(db_session, orgs):
    p = _user_with_rows(db_session, orgs["a"]["org"], ["HR", "RECRUITER"])
    assert client.get(ADMIN_LIST, headers=rh.auth(p["token"])).status_code == 200
    assert _owner_probe(p["token"]) == 403
    assert client.get("/api/auth/me", headers=rh.auth(p["token"])).json()["role"] == "HR"  # lowest id wins ties


def test_inactive_owner_row_is_ignored(db_session, orgs):
    p = _user_with_rows(db_session, orgs["a"]["org"], ["HR", "ORGANIZATION_ADMIN"], ["active", "deactivated"])
    assert _owner_probe(p["token"]) == 403
    assert client.get("/api/auth/me", headers=rh.auth(p["token"])).json()["role"] == "HR"


def test_owner_rows_in_one_org_grant_nothing_in_another(db_session, orgs):
    p = _user_with_rows(db_session, orgs["a"]["org"], ["HR", "ORGANIZATION_ADMIN"])
    foreign = client.get(ADMIN_LIST, headers=rh.auth(p["token"], orgs["b"]["org"].id))
    assert foreign.status_code == 403 and "not an active member" in foreign.json()["detail"]
    assert _owner_probe(p["token"], orgs["b"]["org"].id) == 403


def test_owner_in_other_org_does_not_elevate_hr_row_in_anchor_org(db_session, orgs):
    """HR in A (anchor) + owner in B: the A header must resolve to HR, the B header to owner."""
    p = rh.make_admin(db_session, org=orgs["a"]["org"], member_role="HR")
    db_session.add(models.OrganizationMember(organization_id=orgs["b"]["org"].id, user_id=p["user"].id,
                                             role="ORGANIZATION_ADMIN", status="active"))
    db_session.commit()
    assert _owner_probe(p["token"], orgs["a"]["org"].id) == 403
    assert _owner_probe(p["token"], orgs["b"]["org"].id) != 403
    assert _owner_probe(p["token"]) == 403  # anchor org A, no header
    me = client.get("/api/auth/me", headers=rh.auth(p["token"])).json()
    assert me["organization_id"] == orgs["a"]["org"].id and me["role"] == "HR"


def test_single_membership_behaviour_unchanged(db_session, orgs):
    owner, hr = orgs["a"], rh.make_admin(db_session, org=orgs["a"]["org"], member_role="HR")
    assert _owner_probe(owner["token"]) != 403
    assert _owner_probe(hr["token"]) == 403
    assert client.get("/api/auth/me", headers=rh.auth(hr["token"])).json()["role"] == "HR"


def test_demoting_one_row_demotes_every_duplicate_row(db_session, orgs):
    actor = orgs["a"]
    target = _user_with_rows(db_session, orgs["a"]["org"], ["ORGANIZATION_ADMIN", "ORGANIZATION_ADMIN"])
    assert _owner_probe(target["token"]) != 403
    res = client.patch(f"/api/organization/users/{target['member'].id}", headers=rh.auth(actor["token"]), json={"role": "HR"})
    assert res.status_code == 200, res.text
    db_session.expire_all()
    rows = db_session.query(models.OrganizationMember).filter_by(user_id=target["user"].id).all()
    assert len(rows) == 2 and {r.role for r in rows} == {"HR"}
    assert _owner_probe(target["token"]) == 403


def test_deactivating_one_row_deactivates_every_duplicate_row(db_session, orgs):
    target = _user_with_rows(db_session, orgs["a"]["org"], ["HR", "ORGANIZATION_ADMIN"])
    res = client.patch(f"/api/organization/users/{target['member'].id}", headers=rh.auth(orgs["a"]["token"]), json={"status": "deactivated"})
    assert res.status_code == 200, res.text
    db_session.expire_all()
    rows = db_session.query(models.OrganizationMember).filter_by(user_id=target["user"].id).all()
    assert {r.status for r in rows} == {"deactivated"}
