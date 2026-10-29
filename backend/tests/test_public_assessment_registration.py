import json
from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlalchemy.exc import IntegrityError

import database
import models
from services import assessment_flow_service as flow
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
def _limits():
    h.reset_public_limiters()
    yield
    h.reset_public_limiters()


def test_public_assessment_metadata_safe(env):
    r = client.get(f"/api/public/assessment/{env['token']}")
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"title", "role", "organization_name", "description_snippet", "sections", "total_duration_minutes", "rules"}
    assert body["total_duration_minutes"] == 60
    assert [s["minutes"] for s in body["sections"]] == [20, 20, 10]
    text = json.dumps(body).lower()
    for forbidden in ("correct_key", "hidden_test", "blueprint", "registration", "share_token", '"id"', "organization_id"):
        assert forbidden not in text


def test_unknown_token_404(env):
    assert client.get("/api/public/assessment/" + "x" * 64).status_code == 404


def test_candidate_registration_success(db, env):
    r, email = h.register(env["token"])
    assert r.status_code == 200
    body = r.json()
    assert body["message"] == "Registration successful"
    token = body["registration_token"]
    assert len(token) >= 43
    row = db.query(models.CandidateRegistration).filter_by(email=email).first()
    # secret stored only as a SHA-256 hash
    assert row.registration_token_hash == flow.sha256_hex(token)
    assert token not in json.dumps({c.name: str(getattr(row, c.name)) for c in row.__table__.columns})
    assert row.status == "REGISTERED" and row.attempt_session_uuid is None
    assert row.phone == "+14155550123"


def test_registration_does_not_create_attempt_or_start_timer(db, env):
    r, email = h.register(env["token"])
    assert r.status_code == 200
    row = db.query(models.CandidateRegistration).filter_by(email=email).first()
    assert db.query(models.RoleReadySession).filter_by(registration_id=row.id).count() == 0


def test_email_normalization_on_registration(db, env):
    r, _ = h.register(env["token"], email="  ALICE.Norm@Example.COM ")
    assert r.status_code == 200
    row = db.query(models.CandidateRegistration).filter(models.CandidateRegistration.email == "alice.norm@example.com").first()
    assert row is not None
    r2, _ = h.register(env["token"], email="alice.norm@example.com")
    assert r2.status_code == 409
    r3, _ = h.register(env["token"], email="ALICE.NORM@EXAMPLE.COM")
    assert r3.status_code == 409


def test_duplicate_email_registration_returns_409_without_token(env):
    r, email = h.register(env["token"])
    assert r.status_code == 200
    dup, _ = h.register(env["token"], email=email)
    assert dup.status_code == 409
    assert "registration_token" not in dup.text
    assert "already registered" in dup.json()["detail"]


def test_duplicate_after_attempt_started_has_distinct_message_and_no_token(env):
    token, email = h.register_ok(env["token"])
    h.start_ok(env["token"], token)
    dup, _ = h.register(env["token"], email=email)
    assert dup.status_code == 409
    assert "already been initiated" in dup.json()["detail"]
    assert "token" not in dup.text.lower()


@pytest.mark.parametrize("payload,fragment", [
    ({"name": "A", "phone": "+14155550123", "email": "ok@example.com"}, "name"),
    ({"name": "Valid Name", "phone": "12345", "email": "ok@example.com"}, "phone"),
    ({"name": "Valid Name", "phone": "+14155550123", "email": "not-an-email"}, "email"),
    ({"name": "Valid Name", "phone": "+14155550123", "email": ""}, "email"),
])
def test_invalid_input_returns_422(env, payload, fragment):
    r = client.post(f"/api/public/assessment/{env['token']}/register", json=payload)
    assert r.status_code == 422
    assert fragment in r.json()["detail"].lower()


def test_historical_unnormalized_rows_found_without_mutation(db, env):
    job_id = db.query(models.JobDescription).filter_by(share_token=env["token"]).first().id
    org_id = db.query(models.JobDescription).filter_by(share_token=env["token"]).first().organization_id
    legacy = models.CandidateRegistration(
        registration_token_hash="a" * 64, job_description_id=job_id, organization_id=org_id,
        name="Charlie Old", phone="+14155550000", email="  Charlie@OldCo.com ", status="REGISTERED")
    db.add(legacy)
    db.commit()
    r, _ = h.register(env["token"], email="charlie@oldco.com")
    assert r.status_code == 409
    db.expire_all()
    assert db.query(models.CandidateRegistration).filter_by(id=legacy.id).first().email == "  Charlie@OldCo.com "


def test_database_rejects_normalized_duplicates_directly(db, env):
    token, email = h.register_ok(env["token"])
    job = db.query(models.JobDescription).filter_by(share_token=env["token"]).first()
    dup = models.CandidateRegistration(
        registration_token_hash="b" * 64, job_description_id=job.id, organization_id=job.organization_id,
        name="Dup", phone="+14155550001", email=f"  {email.upper()}  ", status="REGISTERED")
    db.add(dup)
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_same_email_may_register_for_different_assessments(db, env, monkeypatch):
    other = h.create_published_job(env["admin"], monkeypatch)
    email = f"multi.{h.new_tag()}@example.com"
    r1, _ = h.register(env["token"], email=email)
    r2, _ = h.register(other["share_token"], email=email)
    assert r1.status_code == 200 and r2.status_code == 200


def test_concurrent_registrations_with_case_and_whitespace_variants(env):
    base = f"dave.{h.new_tag()}"
    variants = [f"{base}@co.com", f"{base.capitalize()}@co.com", f" {base}@co.com ", f"{base.upper()}@CO.COM", f"{base}@Co.com"]

    def go(email):
        r = client.post(f"/api/public/assessment/{env['token']}/register",
                        json={"name": "Dave Concurrent", "phone": "+14155550123", "email": email})
        return r.status_code

    with ThreadPoolExecutor(max_workers=5) as pool:
        codes = list(pool.map(go, variants))
    assert sorted(codes) == [200, 409, 409, 409, 409], codes


def test_rate_limit_five_registrations_per_minute_per_ip(env):
    codes = []
    for i in range(7):
        r, _ = h.register(env["token"])
        codes.append(r.status_code)
    assert codes[:5] == [200] * 5
    assert codes[5:] == [429, 429]


def test_closed_assessment_rejects_registration_and_start(env, db, monkeypatch):
    job = h.create_published_job(env["admin"], monkeypatch)
    token, _ = h.register_ok(job["share_token"])
    closed = client.post(f"/api/admin/job-roles/{job['id']}/close", headers=h.auth(env["admin"]["token"]))
    assert closed.status_code == 200
    r, _ = h.register(job["share_token"])
    assert r.status_code == 410
    assert client.get(f"/api/public/assessment/{job['share_token']}").status_code == 410
    assert h.start(job["share_token"], token).status_code == 410  # registered earlier, but the assessment is closed now


def test_registration_flow_never_leaks_other_candidates(env):
    h.register_ok(env["token"], name="Secret Person")
    meta = client.get(f"/api/public/assessment/{env['token']}").text
    assert "Secret Person" not in meta


def test_client_ip_resolution_behind_a_trusted_reverse_proxy(monkeypatch):
    import types
    from services.rate_limiter import client_ip

    def req(peer, headers=None):
        return types.SimpleNamespace(client=types.SimpleNamespace(host=peer) if peer else None, headers=headers or {})

    # nginx (private peer) sets X-Real-IP -> each candidate is limited individually, not the whole deployment
    assert client_ip(req("172.18.0.5", {"x-real-ip": "203.0.113.9"})) == "203.0.113.9"
    assert client_ip(req("10.0.0.2", {"x-real-ip": "2001:db8::7"})) == "2001:db8::7"
    # untrusted (public) peer can never choose its own identity
    assert client_ip(req("198.51.100.20", {"x-real-ip": "203.0.113.9", "x-forwarded-for": "203.0.113.9"})) == "198.51.100.20"
    # garbage / missing headers fall back to the peer; non-IP peers (test clients) are used verbatim
    assert client_ip(req("172.18.0.5", {"x-real-ip": "not-an-ip"})) == "172.18.0.5"
    assert client_ip(req("172.18.0.5")) == "172.18.0.5"
    assert client_ip(req("testclient")) == "testclient"
    assert client_ip(req(None)) == "unknown"
    # X-Forwarded-For is ignored even from a trusted proxy (its left-most entries are client controlled)
    assert client_ip(req("172.18.0.5", {"x-forwarded-for": "1.2.3.4"})) == "172.18.0.5"
    # operators can narrow the trusted set
    monkeypatch.setenv("PREPWIN_TRUSTED_PROXIES", "192.0.2.0/24")
    assert client_ip(req("172.18.0.5", {"x-real-ip": "203.0.113.9"})) == "172.18.0.5"
    assert client_ip(req("192.0.2.10", {"x-real-ip": "203.0.113.9"})) == "203.0.113.9"
