"""
audit_job_roles.py: classification of test-fixture residue, and the guarded cleanup.

Everything runs on a throw-away database built for each test. The audit must never write; the cleanup must refuse anything that is
not an unprotected test-fixture draft, must be all-or-nothing, and must leave every protected role and every row that depends on a
role (registrations, batches, invitations, sessions, blueprints) exactly as it was.
"""
import hashlib
import json
import os
import sqlite3

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import audit_job_roles as audit
import database
import models

LONG = "We are hiring an engineer to build Python and FastAPI services backed by SQL databases and own reliability in production."


@pytest.fixture()
def world(tmp_path):
    path = tmp_path / "roles.db"
    engine = create_engine(f"sqlite:///{path.as_posix()}", connect_args={"check_same_thread": False})
    models.Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    db = Session()

    real = models.Organization(name="Acme Hiring", slug="acme-hiring", status="active")
    test_org = models.Organization(name="RW Org abc123", slug="rw-org-abc123", status="active")
    db.add_all([real, test_org])
    db.commit()
    ids = {}

    def role(key, title, desc="", org=real.id, **kw):
        j = models.JobDescription(title=title, role=title, description=desc, organization_id=org, **kw)
        db.add(j)
        db.commit()
        ids[key] = j.id
        return j

    for n in range(3):
        role(f"lead{n}", "Lead Architect")                                   # repeated, empty description: the test-suite signature
    role("lone_backend_lead", "Backend Lead")                               # one empty-description row: a plausible real draft, kept
    role("long_fixture_title0", "Backend Developer", LONG)                  # fixture-looking title but written like a real JD, kept
    role("long_fixture_title1", "Backend Developer", LONG)
    role("real_draft", "Platform Engineer", LONG)                           # a normal draft with no blueprint and no candidates, kept
    role("in_test_org", "Anything At All", "x", org=test_org.id)
    role("orphan_fixture", "Senior Backend Architect", "", org=999)         # organization row does not exist
    role("orphan_other", "Quarterly Hiring Plan", LONG, org=999)            # missing organization but not a fixture: only flagged
    published = role("published", "Full Stack Engineer", LONG, is_published=True, status="PUBLISHED", share_token="tok-published", blueprint_version=1)
    db.add(models.JobBlueprintVersion(job_description_id=published.id, version=1, blueprint_data={"x": 1}))
    role("closed", "Closed Role", LONG, is_published=False, status="CLOSED", blueprint_version=1)
    with_reg = role("with_registration", "Lead Architect")                  # fixture-looking, but a candidate registered
    db.add(models.CandidateRegistration(registration_token_hash="h" * 64, job_description_id=with_reg.id, organization_id=real.id,
                                        name="Real Candidate", phone="+14155550123", email="c@example.com"))
    with_batch = role("with_batch", "Lead Architect")                       # fixture-looking, but a recruitment batch points at it
    db.add(models.RecruitmentBatch(organization_id=real.id, job_description_id=with_batch.id, batch_name="Real batch"))
    db.commit()
    yield {"Session": Session, "db": db, "ids": ids, "path": str(path), "tmp": tmp_path, "real": real, "test_org": test_org}
    db.close()
    engine.dispose()


def classes(db):
    return {r["id"]: r["classification"] for r in audit.build_audit(db)["rows"]}


def snapshot(db):
    db.rollback()
    h = hashlib.sha256()
    for table in models.Base.metadata.sorted_tables:
        for row in db.execute(table.select().order_by(*table.primary_key.columns)).fetchall():
            h.update(repr(tuple(row)).encode())
    return h.hexdigest()


# ------------------------------------------------------------------------------ classification
def test_classification(world):
    c, i = classes(world["db"]), world["ids"]
    fixtures = {"lead0", "lead1", "lead2", "in_test_org", "orphan_fixture"}
    protected = {"published", "closed", "with_registration", "with_batch"}
    kept = {"lone_backend_lead", "long_fixture_title0", "long_fixture_title1", "real_draft", "orphan_other"}
    for key in fixtures:
        assert c[i[key]] == audit.FIXTURE, key
    for key in protected:
        assert c[i[key]] == audit.PROTECTED, key
    for key in kept:
        assert c[i[key]] == audit.LEGIT, key


def test_every_reference_to_a_role_is_discovered_from_the_models(world):
    refs = {(r["table"], r["column"]) for r in audit.referencing_columns()}
    assert {("candidate_registrations", "job_description_id"), ("job_blueprint_versions", "job_description_id"),
            ("recruitment_batches", "job_description_id"), ("roleready_sessions", "job_description_id"),
            ("candidate_invitations", "job_description_id")} <= refs


def test_reasons_explain_each_classification(world):
    rows = {r["id"]: r for r in audit.build_audit(world["db"])["rows"]}
    assert any("referenced by candidate_registrations" in x for x in rows[world["ids"]["with_registration"]]["reasons"])
    assert any("no longer exists" in x for x in rows[world["ids"]["orphan_fixture"]]["reasons"])
    assert any("repeated 5x" in x for x in rows[world["ids"]["lead0"]]["reasons"])
    assert any("test-fixture organization" in x for x in rows[world["ids"]["in_test_org"]]["reasons"])


def test_duplicates_involving_a_real_record_are_reported_for_a_human(world):
    dups = audit.build_audit(world["db"])["possible_duplicates"]
    pair = [d for d in dups if d["title"] == "Backend Developer"]
    assert pair and sorted(pair[0]["ids"]) == sorted([world["ids"]["long_fixture_title0"], world["ids"]["long_fixture_title1"]])
    assert not [d for d in dups if d["title"] == "Lead Architect" and set(d["classifications"].values()) == {audit.FIXTURE}], \
        "pure test-fixture duplicates are handled by the fixture classification, not reported as a dilemma"


def test_the_audit_never_writes(world):
    before = snapshot(world["db"])
    audit.build_audit(world["db"])
    audit.build_audit(world["db"])
    assert not world["db"].new and not world["db"].dirty and not world["db"].deleted
    assert snapshot(world["db"]) == before


# ------------------------------------------------------------------------------ guarded cleanup
def fixture_ids(w):
    return sorted(w["ids"][k] for k in ("lead0", "lead1", "lead2", "in_test_org", "orphan_fixture"))


def test_dry_run_deletes_nothing(world):
    before = snapshot(world["db"])
    report = audit.cleanup(world["db"], fixture_ids(world), str(world["tmp"] / "bk"), apply=False)
    assert report["dry_run"] is True and report["ids"] == fixture_ids(world)
    assert snapshot(world["db"]) == before and not (world["tmp"] / "bk").exists()


@pytest.mark.parametrize("bad", ["published", "closed", "with_registration", "with_batch", "real_draft", "lone_backend_lead", "orphan_other", "long_fixture_title0"])
def test_anything_that_is_not_an_unprotected_fixture_is_refused_and_nothing_is_deleted(world, bad):
    before = snapshot(world["db"])
    with pytest.raises(audit.CleanupRefused):
        audit.cleanup(world["db"], fixture_ids(world) + [world["ids"][bad]], str(world["tmp"] / "bk"), apply=True)
    assert snapshot(world["db"]) == before, "all-or-nothing: the valid ids were not deleted either"
    assert not (world["tmp"] / "bk").exists(), "not even a backup was written for a refused run"


def test_unknown_ids_are_refused(world):
    with pytest.raises(audit.CleanupRefused):
        audit.cleanup(world["db"], [999999], str(world["tmp"] / "bk"), apply=True)


def test_apply_takes_a_verified_backup_exports_the_rows_and_deletes_exactly_the_listed_ones(world):
    db, ids = world["db"], world["ids"]
    registrations_before = db.query(models.CandidateRegistration).count()
    protected_before = {k: db.query(models.JobDescription).get(ids[k]).title for k in ("published", "closed", "with_registration", "with_batch", "real_draft", "lone_backend_lead")}
    total_before = db.query(models.JobDescription).count()

    report = audit.cleanup(db, fixture_ids(world), str(world["tmp"] / "bk"), apply=True)
    assert report["deleted"] == 5

    db.expire_all()
    assert db.query(models.JobDescription).count() == total_before - 5
    remaining = {j.id for j in db.query(models.JobDescription)}
    assert not (remaining & set(fixture_ids(world)))
    for key, title in protected_before.items():
        assert db.query(models.JobDescription).get(ids[key]).title == title, key
    assert db.query(models.CandidateRegistration).count() == registrations_before, "candidate data is untouched"
    assert db.query(models.RecruitmentBatch).count() == 1 and db.query(models.JobBlueprintVersion).count() == 1

    backup = report["backup"]["backup"]                               # the backup is a real, complete, verified copy
    assert os.path.exists(backup) and len(report["backup"]["sha256"]) == 64
    check = sqlite3.connect(backup)
    try:
        assert check.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert check.execute("SELECT COUNT(*) FROM job_descriptions").fetchone()[0] == total_before
    finally:
        check.close()
    exported = json.load(open(report["export"], encoding="utf-8"))   # and the deleted rows are exported for a manual restore
    assert sorted(r["id"] for r in exported) == fixture_ids(world) and all("title" in r for r in exported)


def test_a_second_run_with_the_same_ids_is_refused(world):
    audit.cleanup(world["db"], fixture_ids(world), str(world["tmp"] / "bk"), apply=True)
    with pytest.raises(audit.CleanupRefused):
        audit.cleanup(world["db"], fixture_ids(world), str(world["tmp"] / "bk2"), apply=True)


def test_a_failed_postcheck_rolls_everything_back(world, monkeypatch):
    before = snapshot(world["db"])
    monkeypatch.setattr(audit, "_protected_fingerprint", lambda *a, **k: str(object()))     # a different fingerprint each time: simulates a protected row changing
    with pytest.raises(audit.CleanupRefused):
        audit.cleanup(world["db"], fixture_ids(world), str(world["tmp"] / "bk"), apply=True)
    assert snapshot(world["db"]) == before


def test_non_sqlite_databases_need_an_explicit_backup_confirmation(world, monkeypatch):
    monkeypatch.setattr(audit, "_sqlite_path", lambda db: None)
    before = snapshot(world["db"])
    with pytest.raises(audit.CleanupRefused):
        audit.cleanup(world["db"], fixture_ids(world), str(world["tmp"] / "bk"), apply=True)
    assert snapshot(world["db"]) == before
    report = audit.cleanup(world["db"], fixture_ids(world), str(world["tmp"] / "bk"), apply=True, backup_confirmed=True)
    assert report["deleted"] == 5


# ------------------------------------------------------------------------------ ids file and CLI
def test_ids_file_parsing(tmp_path):
    f = tmp_path / "ids.txt"
    f.write_text("# header\n12  # Lead Architect\n\n7\n12\n  # only a comment\n", encoding="utf-8")
    assert audit.read_ids(str(f)) == [7, 12]
    f.write_text("# nothing here\n", encoding="utf-8")
    with pytest.raises(audit.CleanupRefused):
        audit.read_ids(str(f))


def test_cli_report_is_read_only_and_cli_cleanup_is_a_dry_run_by_default(world, monkeypatch, capsys):
    monkeypatch.setattr(database, "SessionLocal", world["Session"])
    before = snapshot(world["db"])
    review = world["tmp"] / "review.txt"
    assert audit.main(["--review-ids", str(review), "--csv", str(world["tmp"] / "r.csv")]) == 0
    out = capsys.readouterr().out
    assert "nothing was changed" in out and "PROTECTED roles" in out
    listed = audit.read_ids(str(review))
    assert listed == fixture_ids(world)
    assert audit.main(["--delete-ids", str(review), "--backup-dir", str(world["tmp"] / "bk")]) == 0
    assert "nothing was deleted" in capsys.readouterr().out
    assert snapshot(world["db"]) == before
    bad = world["tmp"] / "bad.txt"
    bad.write_text(f"{world['ids']['published']}\n", encoding="utf-8")
    assert audit.main(["--delete-ids", str(bad), "--backup-dir", str(world["tmp"] / "bk"), "--apply"]) == 2
    assert "REFUSED" in capsys.readouterr().out and snapshot(world["db"]) == before
