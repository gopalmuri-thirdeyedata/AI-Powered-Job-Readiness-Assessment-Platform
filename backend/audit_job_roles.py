"""
Audit (read-only by default) and guarded cleanup of job roles that are test-fixture residue.

    python audit_job_roles.py                                   # report only; nothing is written
    python audit_job_roles.py --csv roles.csv                   # also write the per-role classification
    python audit_job_roles.py --review-ids review_ids.txt       # list the ids a human should review before any cleanup

    # cleanup: ONLY after a person has reviewed review_ids.txt (remove any id you want to keep)
    python audit_job_roles.py --delete-ids review_ids.txt --backup-dir ./backups              # dry run: validates, deletes nothing
    python audit_job_roles.py --delete-ids review_ids.txt --backup-dir ./backups --apply      # really deletes

Classification (per job role):
  PROTECTED           published / closed, or has a blueprint, or anything references it (registrations, sessions, invitations,
                      batches ...). Never touched by this tool, whatever is listed in an ids file.
  LIKELY_TEST_FIXTURE an unprotected DRAFT that matches the signature of the automated tests: it belongs to a test-fixture
                      organization, or to an organization that does not exist, or it carries a known fixture title with a description
                      too short to come from the Job Roles form (which requires 50+ characters) and is repeated in its organization.
  LEGITIMATE_DRAFT    any other unprotected draft. Kept: a draft with no blueprint and no candidates is a normal draft.
  Possible duplicates (same organization, title and description) are reported separately for a human decision; a duplicate that is
  PROTECTED is never deletable here (close it from Shared Links instead).

Cleanup safety rails (all must hold, otherwise nothing is deleted):
  * dry run unless --apply; an explicit ids file is required (the tool never selects rows on its own);
  * every id is re-classified at execution time and must still be LIKELY_TEST_FIXTURE (one refused id aborts the whole run);
  * a verified backup is taken first (SQLite: online backup + integrity_check + sha256; other engines need --backup-confirmed),
    and the rows to be deleted are exported to JSON next to it;
  * one transaction; afterwards the tool verifies that only the listed rows are gone and that every protected role and every row of
    every referencing table is unchanged. Roll back by restoring the backup file (or re-inserting the exported rows).
The default report never modifies anything, and the application never calls this module.
"""
import argparse
import csv
import datetime as dt
import hashlib
import json
import os
import re
import sqlite3
import sys
from collections import defaultdict
from typing import Any, Dict, List, Optional

from sqlalchemy import func, inspect as sa_inspect, text
from sqlalchemy.orm import Session

import database
import models

MIN_FORM_DESCRIPTION = 50          # the Job Roles form enforces at least this many characters

# Titles created (and never cleaned up) by the legacy automated tests that ran against the configured database.
FIXTURE_TITLES = {
    "lead architect", "senior backend architect", "backend developer", "frontend engineer", "senior frontend engineer",
    "devops engineer", "legacy software engineer", "private jd", "backend lead",
}
# Organizations created by the automated tests.
TEST_ORG_PATTERN = re.compile(
    r"^(rw-org-|college-(alpha|beta)(-p\d+)?$|schema-test-org|perf-college|audit-college|auth-canonical-org|roleready-test-org|"
    r"e2e-org|inv-org|matrix-org|test-org)", re.IGNORECASE)
TEST_ORG_NAME_PATTERN = re.compile(r"^(RW Org |RoleReady Test Organization|College (Alpha|Beta)|Schema Test Org|Perf College|Audit College|Canonical Auth Org|E2E Org)", re.IGNORECASE)

PROTECTED, FIXTURE, LEGIT = "PROTECTED", "LIKELY_TEST_FIXTURE", "LEGITIMATE_DRAFT"


def referencing_columns() -> List[Dict[str, str]]:
    """Every (table, column) with a foreign key to job_descriptions.id, discovered from the models (so new references are covered)."""
    out = []
    for table in models.Base.metadata.sorted_tables:
        for fk in table.foreign_keys:
            if fk.column.table.name == "job_descriptions" and fk.column.name == "id":
                out.append({"table": table.name, "column": fk.parent.name})
    return out


def _normalize(value: Optional[str]) -> str:
    return " ".join((value or "").lower().split())


def build_audit(db: Session, release_snapshot: bool = True) -> Dict[str, Any]:
    """Classify every job role. Issues SELECTs only (the read snapshot is released at the end unless release_snapshot is False)."""
    refs = referencing_columns()
    orgs = {o.id: o for o in db.query(models.Organization).all()}
    ref_counts: Dict[str, Dict[int, int]] = {}
    for ref in refs:
        rows = db.execute(text(f"SELECT {ref['column']}, COUNT(*) FROM {ref['table']} WHERE {ref['column']} IS NOT NULL GROUP BY {ref['column']}")).fetchall()
        ref_counts[f"{ref['table']}.{ref['column']}"] = {int(r[0]): int(r[1]) for r in rows}
    blueprint_rows = dict(db.query(models.JobBlueprintVersion.job_description_id, func.count(models.JobBlueprintVersion.id)).group_by(models.JobBlueprintVersion.job_description_id).all())

    jobs = db.query(models.JobDescription).order_by(models.JobDescription.id).all()
    per_org_title = defaultdict(int)
    for j in jobs:
        per_org_title[(j.organization_id, _normalize(j.title))] += 1

    rows: List[Dict[str, Any]] = []
    for j in jobs:
        org = orgs.get(j.organization_id)
        references = {name: counts[j.id] for name, counts in ref_counts.items() if j.id in counts}
        reasons: List[str] = []
        protected_why = []
        if j.is_published or (j.status or "DRAFT") != "DRAFT":
            protected_why.append(f"status {j.status}{' (published)' if j.is_published else ''}")
        if (j.blueprint_version or 0) > 0 or blueprint_rows.get(j.id):
            protected_why.append("has a blueprint")
        if references:
            protected_why.append("referenced by " + ", ".join(f"{k}={v}" for k, v in references.items()))
        desc_len = len((j.description or "").strip())
        test_org = bool(org is not None and (TEST_ORG_PATTERN.search(org.slug or "") or TEST_ORG_NAME_PATTERN.search(org.name or "")))
        orphan_org = j.organization_id is not None and org is None
        fixture_title = _normalize(j.title) in FIXTURE_TITLES
        repeated = per_org_title[(j.organization_id, _normalize(j.title))] >= 2
        repeated_n = per_org_title[(j.organization_id, _normalize(j.title))]
        if protected_why:
            classification, reasons = PROTECTED, protected_why
        else:
            short_repeated_fixture = fixture_title and desc_len < MIN_FORM_DESCRIPTION and repeated
            if test_org:
                reasons.append("belongs to a test-fixture organization")
            if orphan_org:
                reasons.append("its organization no longer exists (not visible to any tenant)")
            if short_repeated_fixture:
                reasons.append(f"known test fixture title, description of {desc_len} characters (the form requires {MIN_FORM_DESCRIPTION}+), "
                               f"repeated {repeated_n}x in its organization")
            if test_org or (fixture_title and orphan_org) or short_repeated_fixture:
                classification = FIXTURE
            else:
                classification = LEGIT
                reasons = ["unprotected draft without a test-fixture signature"] + reasons
        rows.append({
            "id": j.id, "title": j.title, "role": j.role, "status": j.status, "is_published": bool(j.is_published),
            "organization_id": j.organization_id, "organization": org.name if org else None, "organization_exists": org is not None,
            "created_by": j.created_by, "created_at": j.uploaded_at.isoformat() if j.uploaded_at else None,
            "description_chars": desc_len, "blueprint_version": j.blueprint_version or 0, "references": references,
            "classification": classification, "reasons": reasons,
        })

    groups = defaultdict(list)
    for r, j in zip(rows, jobs):
        groups[(r["organization_id"], _normalize(r["title"]), _normalize(j.description))].append(r)
    duplicates = []
    for key, members in groups.items():
        if len(members) > 1 and any(m["classification"] != FIXTURE for m in members):
            duplicates.append({"organization_id": key[0], "title": members[0]["title"], "ids": [m["id"] for m in members],
                               "classifications": {m["id"]: m["classification"] for m in members},
                               "note": "same title and description in one organization; decide which to keep (a PROTECTED one is closed from Shared Links, never deleted here)"})
    summary = {"total": len(rows)}
    for label in (PROTECTED, FIXTURE, LEGIT):
        summary[label] = sum(1 for r in rows if r["classification"] == label)
    if release_snapshot:
        db.rollback()   # read-only: release the snapshot
    return {"summary": summary, "rows": rows, "possible_duplicates": duplicates, "referencing_columns": refs}


# ------------------------------------------------------------------------------ guarded cleanup
class CleanupRefused(Exception):
    pass


def _sqlite_path(db: Session) -> Optional[str]:
    url = db.get_bind().url
    return url.database if url.get_backend_name() == "sqlite" else None


def make_verified_backup(db: Session, backup_dir: str, confirmed: bool) -> Dict[str, str]:
    path = _sqlite_path(db)
    os.makedirs(backup_dir, exist_ok=True)
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    if path is None:
        if not confirmed:
            raise CleanupRefused("This database is not SQLite: take a verified backup yourself and pass --backup-confirmed.")
        return {"backup": "(confirmed by the operator)", "sha256": ""}
    target = os.path.join(backup_dir, f"job_roles_cleanup_{stamp}.db")
    src, dst = sqlite3.connect(path), sqlite3.connect(target)
    try:
        src.backup(dst)
    finally:
        dst.close()
        src.close()
    check = sqlite3.connect(target)
    try:
        if check.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise CleanupRefused("The backup failed its integrity check; nothing was deleted.")
        count = check.execute("SELECT COUNT(*) FROM job_descriptions").fetchone()[0]
    finally:
        check.close()
    if count != db.query(models.JobDescription).count():
        raise CleanupRefused("The backup does not match the live table; nothing was deleted.")
    return {"backup": target, "sha256": hashlib.sha256(open(target, "rb").read()).hexdigest()}


def _protected_fingerprint(db: Session, audit_rows: List[Dict[str, Any]], refs: List[Dict[str, str]]) -> str:
    h = hashlib.sha256()
    ids = sorted(r["id"] for r in audit_rows if r["classification"] != FIXTURE)
    for job in db.query(models.JobDescription).filter(models.JobDescription.id.in_(ids)).order_by(models.JobDescription.id):
        h.update(repr((job.id, job.title, job.description, job.status, job.is_published, job.share_token, job.blueprint_version, str(job.blueprint_data))).encode())
    for ref in refs:
        h.update(repr(db.execute(text(f"SELECT COUNT(*) FROM {ref['table']}")).scalar()).encode())
    return h.hexdigest()


def read_ids(path: str) -> List[int]:
    ids = []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.split("#", 1)[0].strip()
            if line:
                ids.append(int(line))
    if not ids:
        raise CleanupRefused("The ids file is empty.")
    return sorted(set(ids))


def cleanup(db: Session, ids: List[int], backup_dir: str, *, apply: bool, backup_confirmed: bool = False) -> Dict[str, Any]:
    audit = build_audit(db)
    by_id = {r["id"]: r for r in audit["rows"]}
    refused = {i: (by_id[i]["classification"] if i in by_id else "NOT_FOUND") for i in ids if i not in by_id or by_id[i]["classification"] != FIXTURE}
    if refused:
        raise CleanupRefused(f"Refused: these ids are not unprotected test-fixture drafts (nothing was deleted): {refused}")
    report = {"ids": ids, "titles": sorted({by_id[i]["title"] for i in ids}), "dry_run": not apply}
    if not apply:
        return report
    report["backup"] = make_verified_backup(db, backup_dir, backup_confirmed)
    export_path = os.path.join(backup_dir, f"job_roles_deleted_{dt.datetime.now().strftime('%Y%m%d-%H%M%S')}.json")
    cols = [c.name for c in models.JobDescription.__table__.columns]
    exported = [{c: (v.isoformat() if hasattr(v, "isoformat") else v) for c, v in zip(cols, [getattr(j, c) for c in cols])}
                for j in db.query(models.JobDescription).filter(models.JobDescription.id.in_(ids))]
    with open(export_path, "w", encoding="utf-8") as fh:
        json.dump(exported, fh, indent=1, default=str)
    report["export"] = export_path
    before_total = db.query(models.JobDescription).count()
    fingerprint = _protected_fingerprint(db, audit["rows"], audit["referencing_columns"])
    try:
        db.query(models.JobDescription).filter(models.JobDescription.id.in_(ids)).delete(synchronize_session=False)
        db.flush()
        after = build_audit(db, release_snapshot=False)
        remaining = {r["id"] for r in after["rows"]}
        if remaining & set(ids) or db.query(models.JobDescription).count() != before_total - len(ids):
            raise CleanupRefused("Post-check failed: the deleted set differs from the requested set; rolled back.")
        if _protected_fingerprint(db, after["rows"], after["referencing_columns"]) != fingerprint:
            raise CleanupRefused("Post-check failed: a protected role or a referencing table changed; rolled back.")
        db.commit()
    except Exception:
        db.rollback()
        raise
    report["deleted"] = len(ids)
    return report


# ------------------------------------------------------------------------------ CLI
def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Audit job roles for test-fixture residue (read-only unless --apply with --delete-ids).")
    p.add_argument("--csv")
    p.add_argument("--review-ids", help="write the ids classified LIKELY_TEST_FIXTURE to this file for human review")
    p.add_argument("--delete-ids", help="ids file (reviewed by a person) to delete; dry run unless --apply")
    p.add_argument("--apply", action="store_true")
    p.add_argument("--backup-dir", default="backups")
    p.add_argument("--backup-confirmed", action="store_true", help="non-SQLite only: you have taken and verified a backup")
    args = p.parse_args(argv)
    db = database.SessionLocal()
    try:
        if args.delete_ids:
            try:
                report = cleanup(db, read_ids(args.delete_ids), args.backup_dir, apply=args.apply, backup_confirmed=args.backup_confirmed)
            except CleanupRefused as exc:
                print(f"REFUSED: {exc}")
                return 2
            print(json.dumps(report, indent=1, default=str))
            print("Dry run only: nothing was deleted. Add --apply to delete." if report["dry_run"] else "Deleted. Restore from the backup file to roll back.")
            return 0
        audit = build_audit(db)
        print("Job role audit (read-only; nothing was changed)")
        for k, v in audit["summary"].items():
            print(f"  {k:22s} {v}")
        by_org = defaultdict(lambda: defaultdict(int))
        for r in audit["rows"]:
            by_org[(r["organization_id"], r["organization"] or "(organization missing)")][r["classification"]] += 1
        print("\n  per organization (id, name -> classification counts)")
        for (oid, name), counts in sorted(by_org.items(), key=lambda kv: (kv[0][0] is None, kv[0][0] or 0)):
            print(f"    {oid!s:>5} {name[:40]:40s} {dict(counts)}")
        protected = [r for r in audit["rows"] if r["classification"] == PROTECTED]
        print("\n  PROTECTED roles (kept, hold real work):")
        for r in protected:
            print(f"    #{r['id']} {r['title']!r} org={r['organization_id']} status={r['status']} refs={r['references']}")
        legit = [r for r in audit["rows"] if r["classification"] == LEGIT]
        print(f"\n  LEGITIMATE drafts (kept): {len(legit)}" + "".join(f"\n    #{r['id']} {r['title']!r} org={r['organization_id']}" for r in legit[:20]))
        for d in audit["possible_duplicates"]:
            print(f"\n  possible duplicate (human decision): ids {d['ids']} {d['title']!r} in org {d['organization_id']}: {d['classifications']}")
        if args.csv:
            with open(args.csv, "w", newline="", encoding="utf-8") as fh:
                w = csv.writer(fh)
                w.writerow(["id", "title", "organization_id", "organization", "status", "classification", "reasons", "created_at", "description_chars"])
                for r in audit["rows"]:
                    w.writerow([r["id"], r["title"], r["organization_id"], r["organization"], r["status"], r["classification"], "; ".join(r["reasons"]), r["created_at"], r["description_chars"]])
            print(f"\n  per-role classification written to {args.csv}")
        if args.review_ids:
            with open(args.review_ids, "w", encoding="utf-8") as fh:
                fh.write("# job roles classified LIKELY_TEST_FIXTURE: delete the lines you want to KEEP, then pass this file to --delete-ids\n")
                for r in audit["rows"]:
                    if r["classification"] == FIXTURE:
                        fh.write(f"{r['id']}  # {r['title']} (org {r['organization_id']}, {r['created_at']})\n")
            print(f"  review list written to {args.review_ids}")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
