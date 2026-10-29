"""
Generate an assessment blueprint ONCE with Gemini, then reuse the same one as often as you like (no more Gemini calls while testing).

  python scripts/blueprint_io.py list                                   # every job role: id, title, blueprint version, valid?
  python scripts/blueprint_io.py export --role-id 7 --out my_bp.json    # save the role's current blueprint to a file
  python scripts/blueprint_io.py import --role-id 9 --file my_bp.json   # load that file into ANOTHER role (or the same one, as a new version)
  python scripts/blueprint_io.py import --role-id 9 --file my_bp.json --publish   # ...and publish it, printing the shared link
  python scripts/blueprint_io.py publish --role-id 9                    # publish / reopen a role; a new link if the 24 h link expired

`import` stores the file as the next blueprint version of the role, exactly like "Generate" does, and tags it "imported" so the admin
screen shows where it came from. It never calls Gemini or the code sandbox, and only publishes with --publish (or the `publish` command).
`sample_blueprint.json` next to this script is a ready-made blueprint (offline fixtures, verified) you can import right away. The file is checked with the same
validation a generated blueprint passes (15 aptitude, 2 coding problems, 5 interview questions; typed coding problems need their
2 examples + 5 hidden tests and a valid signature). A blueprint file contains the answer keys and hidden tests: keep it private.
"""
import argparse
import json
import os
import sys
from datetime import datetime, timezone

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)


def _roles(db):
    import models
    return db.query(models.JobDescription).order_by(models.JobDescription.id).all()


def cmd_list(db, args) -> int:
    from services import jd_blueprint_service as blueprints
    rows = _roles(db)
    if not rows:
        print("No job roles yet.")
    for job in rows:
        try:
            blueprints.validate_blueprint(job.blueprint_data)
            state = "valid"
        except ValueError:
            state = "no valid blueprint"
        print(f"{job.id:>4}  v{job.blueprint_version or 0:<3} {state:<18} {job.status or 'DRAFT':<10} {job.title}")
    return 0


def _get(db, role_id):
    import models
    job = db.query(models.JobDescription).filter(models.JobDescription.id == role_id).first()
    if job is None:
        print(f"Job role {role_id} does not exist (run `list`).")
    return job


def cmd_export(db, args) -> int:
    from services import jd_blueprint_service as blueprints
    job = _get(db, args.role_id)
    if job is None:
        return 2
    try:
        blueprints.validate_blueprint(job.blueprint_data)
    except ValueError as exc:
        print(f"This role has no valid blueprint to export: {exc}")
        return 2
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(job.blueprint_data, fh, indent=2, ensure_ascii=False)
    print(f"Saved blueprint v{job.blueprint_version} of role {job.id} ({job.title}) to {args.out}")
    return 0


def cmd_import(db, args) -> int:
    import models
    from services import jd_blueprint_service as blueprints
    job = _get(db, args.role_id)
    if job is None:
        return 2
    with open(args.file, encoding="utf-8") as fh:
        data = json.load(fh)
    try:
        blueprint = blueprints.validate_blueprint(data)
    except ValueError as exc:
        print(f"Refusing to import: {exc}")
        return 2
    version = (job.blueprint_version or 0) + 1
    blueprint.blueprint_version = version
    stored = blueprint.model_dump()
    stored["generation"] = {"source": "imported", "label": "Imported (no Gemini)", "model": None,
                            "generated_at": datetime.now(timezone.utc).isoformat()}
    db.add(models.JobBlueprintVersion(job_description_id=job.id, version=version, blueprint_data=stored))
    job.blueprint_data = stored
    job.blueprint_version = version
    if job.required_skills in (None, []):
        job.required_skills = stored.get("required_technical_skills") or None
    db.commit()
    print(f"Imported into role {job.id} ({job.title}) as blueprint v{version}.")
    if getattr(args, "publish", False):
        print(f"Shared link (valid 24 hours): {_publish(db, job)}")
    else:
        print("Publish it in the admin screen (or re-run with --publish) to get the shared link.")
    return 0


def _publish(db, job) -> str:
    """Same rules as the admin screen's Publish: first publish issues a link valid 24 h, a still-valid link is reopened, an expired one gets a new link."""
    import secrets
    import models
    from services import assessment_clock as clock
    from services import share_link_policy as link_policy
    now = clock.now()
    if job.share_token and link_policy.is_expired(job, now):
        db.add(models.JobShareLinkHistory(job_description_id=job.id, share_token=job.share_token, expires_at=job.share_link_expires_at))
        job.share_token = None
    if not job.share_token:
        job.share_token = secrets.token_urlsafe(48)
        job.share_link_expires_at = clock.naive_utc(link_policy.new_expiry(now))
    job.is_published = True
    job.status = "PUBLISHED"
    db.commit()
    base = (os.getenv("FRONTEND_URL", "http://localhost:5173") or "").rstrip("/")
    return f"{base}/assessment/join/{job.share_token}"


def cmd_publish(db, args) -> int:
    from services import jd_blueprint_service as blueprints
    job = _get(db, args.role_id)
    if job is None:
        return 2
    try:
        blueprints.validate_blueprint(job.blueprint_data)
    except ValueError as exc:
        print(f"Cannot publish: this role has no valid blueprint ({exc}). Import or generate one first.")
        return 2
    print(f"Shared link (valid 24 hours): {_publish(db, job)}")
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("list")
    export = sub.add_parser("export")
    export.add_argument("--role-id", type=int, required=True)
    export.add_argument("--out", required=True)
    imp = sub.add_parser("import")
    imp.add_argument("--role-id", type=int, required=True)
    imp.add_argument("--file", required=True)
    imp.add_argument("--publish", action="store_true", help="also publish the role and print its shared link")
    pub = sub.add_parser("publish")
    pub.add_argument("--role-id", type=int, required=True)
    args = parser.parse_args(argv)

    import database
    db = database.SessionLocal()
    try:
        return {"list": cmd_list, "export": cmd_export, "import": cmd_import, "publish": cmd_publish}[args.command](db, args)
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
