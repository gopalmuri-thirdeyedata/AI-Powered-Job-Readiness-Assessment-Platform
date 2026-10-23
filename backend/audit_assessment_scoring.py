"""
READ-ONLY audit of historical assessment scores against the canonical equal-weight formula.

    python audit_assessment_scoring.py [--csv report.csv]

Why this exists: before the standardization, Student Platform results were persisted with
overall = 25% aptitude + 40% coding + 35% interview. New results (both workflows) use
(aptitude + coding + interview) / 3 and carry `scoring_model = "equal_v1"` in `final_report_data`.

Historical results are NOT rewritten: a score somebody saw and acted on must not change silently. This tool only reports,
per completed attempt, the persisted overall score, the equal-weight figure it would have had, and the difference, so the
product owner can decide whether an explicit, backed-up, audited recalculation is wanted. It has no write mode on purpose.
If a recalculation is ever approved, run it as its own migration (take a verified backup first, stamp each row with the
previous value and the date) and do not mix it into a deployment.
"""
import argparse
import csv
import sys
from typing import Any, Dict, List

from sqlalchemy.orm import Session

import database
import models
from services import assessment_policy as policy

TOLERANCE = 0.05


def build_audit(db: Session) -> Dict[str, Any]:
    """Compare every COMPLETED attempt's persisted overall score with the equal-weight formula. Issues SELECTs only."""
    rows: List[Dict[str, Any]] = []
    summary = {"completed": 0, "equal_v1": 0, "legacy_weighted": 0, "legacy_unchanged_by_formula": 0, "legacy_would_change": 0,
               "disqualified": 0, "skipped_missing_scores": 0}
    for s in db.query(models.RoleReadySession).filter(models.RoleReadySession.current_state == models.RoleReadySessionState.COMPLETED).all():
        summary["completed"] += 1
        report = s.final_report_data if isinstance(s.final_report_data, dict) else {}
        model = policy.scoring_model_of(report)
        if report.get("is_disqualified"):
            summary["disqualified"] += 1          # an explicit forfeiture, scored 0 by design in every model
            continue
        recorded = float(s.overall_readiness_score or 0.0)
        equal = policy.overall_score(s.aptitude_score, s.coding_score, s.interview_score)
        if equal is None:
            summary["skipped_missing_scores"] += 1
            continue
        if model == policy.SCORING_MODEL:
            summary["equal_v1"] += 1
        else:
            summary["legacy_weighted"] += 1
            if abs(recorded - equal) > TOLERANCE:
                summary["legacy_would_change"] += 1
            else:
                summary["legacy_unchanged_by_formula"] += 1
        rows.append({
            "session_uuid": s.session_uuid, "workflow_type": s.workflow_type, "organization_id": s.organization_id,
            "scoring_model": model, "aptitude": s.aptitude_score, "coding": s.coding_score, "interview": s.interview_score,
            "recorded_overall": round(recorded, 2), "equal_weight_overall": equal, "difference": round(equal - recorded, 2),
        })
    db.rollback()   # read-only: nothing was written, release the snapshot
    return {"summary": summary, "rows": rows}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Read-only audit of historical overall scores vs the equal-weight formula.")
    parser.add_argument("--csv", help="write the per-attempt comparison to this CSV file")
    args = parser.parse_args(argv)
    db = database.SessionLocal()
    try:
        result = build_audit(db)
    finally:
        db.close()
    print("Historical scoring audit (read-only; no row was changed)")
    for key, value in result["summary"].items():
        print(f"  {key:32s} {value}")
    changed = [r for r in result["rows"] if r["scoring_model"] != policy.SCORING_MODEL and abs(r["difference"]) > TOLERANCE]
    if changed:
        print(f"\n  {len(changed)} legacy attempt(s) would show a different overall under equal weighting; first 10:")
        for r in changed[:10]:
            print(f"    {r['session_uuid']}  recorded {r['recorded_overall']:>6}  equal-weight {r['equal_weight_overall']:>6}  ({r['difference']:+})")
    if args.csv:
        with open(args.csv, "w", newline="", encoding="utf-8") as fh:
            writer = csv.DictWriter(fh, fieldnames=list(result["rows"][0].keys()) if result["rows"] else ["session_uuid"])
            writer.writeheader()
            writer.writerows(result["rows"])
        print(f"\n  per-attempt comparison written to {args.csv}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
