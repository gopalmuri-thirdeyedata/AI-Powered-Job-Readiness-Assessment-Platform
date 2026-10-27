"""
Audits STUDENT accounts for a missing / inconsistent organization and (optionally) backfills the ones that can be resolved reliably.

  python scripts/audit_student_organizations.py                      # DRY RUN: report only, changes nothing
  python scripts/audit_student_organizations.py --execute            # backup (SQLite), backfill the reliable cases, audit log, report
  python scripts/audit_student_organizations.py --report out.json    # where to write the JSON report (default: backend/backups/)

Why it matters: a student may only open assessments owned by an organization the student belongs to. An account without any
organization link is refused (and an ActivityLog entry STUDENT_ORGANIZATION_UNRESOLVED is written for an administrator).

Resolution rules (nothing is guessed, no default organization is ever assigned, no access is widened):
  ok                a student whose own organization exists and is left exactly as it is (valid assignments are never changed)
  backfill          the account has NO organization, and its OTHER authoritative records name exactly ONE existing organization:
                    the student profile, an active organization membership, or the legacy company_id. users.organization_id is set to it.
  conflict          those records name more than one organization -> reported, nothing changed
  unresolved        no authoritative record names any organization -> reported, nothing changed (an administrator must assign one)
  profile_mismatch  the account's organization and its profile's organization differ -> reported, nothing changed
  invalid_org       the account points at an organization that no longer exists -> reported, nothing changed
Every backfill writes an ActivityLog row (STUDENT_ORGANIZATION_BACKFILLED: student id, organization, source). Re-running is a no-op.
Passwords and hashes are never read into the report.
"""
import argparse
import json
import os
import sys
from datetime import datetime

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)

BACKFILLED = "STUDENT_ORGANIZATION_BACKFILLED"


def analyze(db) -> dict:
    """Read-only. Returns {"students": N, "ok": [...], "backfill": [...], "conflict": [...], "unresolved": [...], ...}."""
    import models
    org_ids = {r[0] for r in db.query(models.Organization.id)}
    profiles = {p.user_id: p for p in db.query(models.StudentProfile)}
    memberships = {}
    for m in db.query(models.OrganizationMember).filter(models.OrganizationMember.status == "active"):
        memberships.setdefault(m.user_id, set()).add(m.organization_id)

    out = {k: [] for k in ("ok", "backfill", "conflict", "unresolved", "profile_mismatch", "invalid_org")}
    students = db.query(models.User).filter(models.User.role == models.UserRole.STUDENT.value).order_by(models.User.id).all()
    for u in students:
        profile = profiles.get(u.id)
        row = {"user_id": u.id, "email": u.email, "is_active": bool(u.is_active), "organization_id": u.organization_id,
               "profile_organization_id": profile.organization_id if profile else None}
        if u.organization_id is not None:
            if u.organization_id not in org_ids:
                out["invalid_org"].append(row)
            elif profile is not None and profile.organization_id not in (None, u.organization_id):
                out["profile_mismatch"].append(row)
            else:
                out["ok"].append(row)
            continue
        sources = {}
        if profile is not None and profile.organization_id is not None:
            sources.setdefault(profile.organization_id, []).append("student_profile")
        for oid in sorted(memberships.get(u.id, ())):
            sources.setdefault(oid, []).append("active_membership")
        if u.company_id is not None:
            sources.setdefault(u.company_id, []).append("company_id")
        sources = {oid: why for oid, why in sources.items() if oid in org_ids}
        row["candidates"] = {str(oid): why for oid, why in sources.items()}
        if len(sources) == 1:
            (oid, why), = sources.items()
            row.update({"resolution": "backfill", "to_organization_id": oid, "source": "+".join(why)})
            out["backfill"].append(row)
        elif len(sources) > 1:
            out["conflict"].append(row)
        else:
            out["unresolved"].append(row)
    out["students"] = len(students)
    return out


def apply_backfill(db, report: dict) -> int:
    """Applies the `backfill` entries in ONE transaction (rolled back on any error). Returns how many accounts were changed."""
    import models
    changed = 0
    try:
        for row in report["backfill"]:
            user = db.query(models.User).filter(models.User.id == row["user_id"]).with_for_update().first() \
                if db.bind.dialect.name != "sqlite" else db.query(models.User).filter(models.User.id == row["user_id"]).first()
            if user is None or user.organization_id is not None:   # changed since the analysis: never overwrite a valid assignment
                continue
            user.organization_id = row["to_organization_id"]
            profile = db.query(models.StudentProfile).filter(models.StudentProfile.user_id == user.id).first()
            if profile is not None and profile.organization_id is None:
                profile.organization_id = row["to_organization_id"]
            db.add(models.ActivityLog(
                user_id=None, organization_id=row["to_organization_id"], action=BACKFILLED, target=user.email,
                details=json.dumps({"student_user_id": user.id, "from": None, "to": row["to_organization_id"], "source": row["source"]})))
            changed += 1
        db.commit()
    except Exception:
        db.rollback()
        raise
    return changed


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--execute", action="store_true", help="apply the reliable backfills (default: dry run)")
    ap.add_argument("--report", help="path of the JSON report")
    args = ap.parse_args(argv)

    import database
    engine = database.engine
    print(f"Database: {engine.url.render_as_string(hide_password=True)}")
    session = database.SessionLocal()
    try:
        report = analyze(session)
        backup = None
        changed = 0
        if args.execute and report["backfill"]:
            if engine.dialect.name == "sqlite":
                from migrate_share_link_expiry import backup_sqlite
                backup = backup_sqlite(engine)
                print("Backup written:", backup)
            else:
                print("Non-SQLite database: take your own verified backup first.")
            changed = apply_backfill(session, report)
        summary = {k: len(v) for k, v in report.items() if isinstance(v, list)}
        report.update({"generated_at": datetime.utcnow().isoformat() + "Z", "mode": "execute" if args.execute else "dry-run",
                       "summary": summary, "changed": changed, "backup": backup})
    finally:
        session.close()

    path = args.report or os.path.join(BACKEND_DIR, "backups", f"student_organization_audit_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json")
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2)
    print(f"Students: {report['students']}  " + "  ".join(f"{k}={v}" for k, v in report["summary"].items()))
    print(f"Mode: {report['mode']}  accounts changed: {changed}  report: {path}")
    for key in ("conflict", "unresolved", "profile_mismatch", "invalid_org"):
        for row in report[key]:
            print(f"  NEEDS ADMINISTRATOR ({key}): user_id={row['user_id']} email={row['email']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
