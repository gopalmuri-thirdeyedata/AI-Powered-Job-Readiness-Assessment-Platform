"""
Permanent deletion of ONE student account and the personal data that hangs off it (Admin User Management -> Delete).

Why this is explicit instead of "delete the users row":
  * SQLite (the default database here) does not enforce foreign keys unless PRAGMA foreign_keys=ON, which this application never sets,
    so the declared ON DELETE CASCADE rules do not fire there; on MySQL they do, but several tables declare no ON DELETE rule at all
    (activity_logs, notifications, assessments, ...) and would block the delete with an IntegrityError.
  * candidate_registrations.student_user_id is ON DELETE SET NULL: deleting only the user would leave the student's name, phone and
    e-mail behind in an "anonymous" registration, and the attempt behind it.

What is deleted (one transaction; any failure rolls everything back and nothing is removed):
  login (users, auth_sessions, organization_members, credential_deliveries) . student profile and everything keyed by it (resumes,
  roadmaps, tasks, practice attempts, mock interviews + turns, projects, placement simulations + rounds, copilot messages, drive
  applications, self-assessment sessions, their round attempts, feedback) . assessment invitations, shared-link registrations,
  the attempts behind them (including archived retaken attempts), reviews and reports . legacy assessments owned by the account .
  notifications . uploaded resume / JD files (after the commit).

What is retained, deliberately (audit trail, no live personal data):
  activity_logs rows are kept. The student's e-mail in `target` / `details` is replaced by `deleted-user:<id>`, the student is
  detached as actor (user_id -> NULL), and ONE new row records the deletion (who, when, which organization, row counts and the
  SHA-256 of the e-mail so a later erasure request can be verified without storing the address).

What is NOT touched because nothing proves it belongs to this account (reported back, never silently kept):
  e-mail-keyed recruiter records that were never linked to the account: candidates rows, accountless registrations and legacy
  assessments whose only link is the e-mail address.

The schema is walked, not guessed: a table that references users / student profiles without a policy here makes the whole deletion
fail closed (409, nothing deleted) and tests/test_student_deletion.py fails, so a future table cannot be forgotten silently.
"""
import hashlib
import json
import logging
import re
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

import sqlalchemy as sa
from sqlalchemy.orm import Session

import models
from database import Base

log = logging.getLogger("prepwin.student_deletion")

BACKEND_DIR = Path(__file__).resolve().parents[1]
# Uploaded files are removed only when they resolve inside one of these roots (the app stores everything under backend/media).
MEDIA_ROOTS: List[Path] = [BACKEND_DIR / "media"]

DELETED_ACTION = "student_account_deleted"
PSEUDONYM = "deleted-user:{id}"

# Columns referencing users.id whose rows belong to the student and are deleted. Every OTHER referencing column is a "who did it"
# pointer on somebody else's record (activity_logs.user_id, created_by, invited_by ...): it is set to NULL and the record is kept.
USER_OWNED: Set[Tuple[str, str]] = {
    ("organization_members", "user_id"),
    ("auth_sessions", "user_id"),
    ("assessments", "user_id"),
    ("assessment_invitations", "student_user_id"),
    ("notifications", "user_id"),
    ("student_profiles", "user_id"),
    ("candidate_registrations", "student_user_id"),
    ("assessment_reviews", "student_user_id"),
    ("credential_deliveries", "user_id"),
}

# Tables whose rows are deleted by an explicit rule below; everything referencing a student profile is covered generically.
_SESSION_TABLES = (("roleready_sessions", "id"), ("roleready_round_attempts", "session_id"),
                   ("assessment_feedback", "session_id"), ("assessment_reviews", "session_id"))


class StudentDeletionError(Exception):
    def __init__(self, code: str, message: str, status: int = 409):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


def _tables() -> Dict[str, sa.Table]:
    return Base.metadata.tables


def _refs(parent: str) -> List[sa.Column]:
    """Every column (in any table) that declares a foreign key to `parent`."""
    return [fk.parent for t in _tables().values() for fk in t.foreign_keys if fk.column.table.name == parent]


def normalize_email(email: Optional[str]) -> str:
    return (email or "").strip().lower()


def email_digest(email: str) -> str:
    return hashlib.sha256(normalize_email(email).encode("utf-8")).hexdigest()


def schema_gaps() -> List[str]:
    """
    Foreign keys to users.id that this module has no policy for (non-nullable and not user-owned). Empty list = every referencing
    column is either deleted with the student or can be detached. Used at runtime (fail closed) and by the test-suite.
    """
    gaps = []
    for col in _refs("users"):
        if (col.table.name, col.name) in USER_OWNED or col.nullable:
            continue
        gaps.append(f"{col.table.name}.{col.name}")
    return sorted(gaps)


def _chunks(values: List[Any], size: int = 400) -> Iterable[List[Any]]:
    for i in range(0, len(values), size):
        yield values[i:i + size]


def _scalars(db: Session, stmt) -> List[Any]:
    return [r[0] for r in db.execute(stmt).all()]


# ------------------------------------------------------------------------------ discovery
def _registration_ids(db: Session, user_id: int) -> List[int]:
    reg = _tables()["candidate_registrations"]
    return _scalars(db, sa.select(reg.c.id).where(reg.c.student_user_id == user_id))


def _archived_session_ids(db: Session, reg_ids: List[int]) -> List[int]:
    """
    A retake authorised by an administrator archives the old attempt with registration_id = NULL, so nothing links it to the
    registration any more except the acknowledgement log written when the attempt started (target=session:<uuid>, details carries
    the registration id). Those archived attempts still hold the student's answers, so they are found through that record.
    """
    if not reg_ids:
        return []
    logs, sess = _tables()["activity_logs"], _tables()["roleready_sessions"]
    uuids: List[str] = []
    for reg_id in reg_ids:
        rows = db.execute(sa.select(logs.c.target, logs.c.details).where(
            logs.c.action == "ASSESSMENT_RULES_ACKNOWLEDGED", logs.c.target.like("session:%"),
            logs.c.details.contains(f'"registration_id": {reg_id},'))).all()
        for target, details in rows:
            try:
                if json.loads(details or "{}").get("registration_id") == reg_id:
                    uuids.append(target.split(":", 1)[1])
            except (ValueError, AttributeError):
                continue
    return _scalars(db, sa.select(sess.c.id).where(sess.c.session_uuid.in_(uuids))) if uuids else []


def _session_ids(db: Session, user_id: int, profile_id: Optional[int], reg_ids: List[int]) -> List[int]:
    sess, reviews = _tables()["roleready_sessions"], _tables()["assessment_reviews"]
    ids: Set[int] = set(_scalars(db, sa.select(reviews.c.session_id).where(reviews.c.student_user_id == user_id)))
    if profile_id is not None:
        ids |= set(_scalars(db, sa.select(sess.c.id).where(sess.c.student_profile_id == profile_id)))
    if reg_ids:
        ids |= set(_scalars(db, sa.select(sess.c.id).where(sess.c.registration_id.in_(reg_ids))))
    ids |= set(_archived_session_ids(db, reg_ids))
    return sorted(ids)


def _file_paths(db: Session, profile_id: Optional[int], user_id: int, session_ids: List[int]) -> Set[str]:
    """Upload paths recorded in the database, plus files the application names after this student (never stored in a row)."""
    paths: Set[str] = set()
    if profile_id is not None:
        res = _tables()["student_resumes"]
        paths |= {p for p in _scalars(db, sa.select(res.c.file_path).where(res.c.student_profile_id == profile_id)) if p}
    if session_ids:
        sess = _tables()["roleready_sessions"]
        paths |= {p for p in _scalars(db, sa.select(sess.c.resume_file_path).where(sess.c.id.in_(session_ids))) if p}
    for root in MEDIA_ROOTS:
        if profile_id is not None and (root / "roleready").is_dir():
            for pattern in (f"resume_student_{profile_id}_*", f"jd_student_{profile_id}_*"):
                paths |= {str(p) for p in (root / "roleready").glob(pattern)}
        if (root / "student_resumes").is_dir():
            paths |= {str(p) for p in (root / "student_resumes").glob(f"student_{user_id}_v*")}
    return paths


def _unlinked_email_records(db: Session, email: str, user_id: int) -> Dict[str, int]:
    """Records that merely carry the same e-mail address. They are reported, not deleted (see the module docstring)."""
    t = _tables()
    cand, reg, ass = t["candidates"], t["candidate_registrations"], t["assessments"]
    count = lambda stmt: int(db.execute(stmt).scalar() or 0)  # noqa: E731
    return {
        "candidates": count(sa.select(sa.func.count()).select_from(cand).where(sa.func.lower(sa.func.trim(cand.c.email)) == email)),
        "accountless_registrations": count(sa.select(sa.func.count()).select_from(reg).where(
            sa.func.lower(sa.func.trim(reg.c.email)) == email, reg.c.student_user_id.is_(None))),
        "email_only_assessments": count(sa.select(sa.func.count()).select_from(ass).where(
            sa.func.lower(ass.c.candidate_email) == email, sa.or_(ass.c.user_id.is_(None), ass.c.user_id != user_id))),
    }


# ------------------------------------------------------------------------------ the deletion
def _delete_rows(db: Session, table: sa.Table, conditions: List[Tuple[str, List[Any]]]) -> List[int]:
    """Deletes every row of `table` matching ANY (column IN values) condition. Returns the primary keys that were removed."""
    clauses = [table.c[col].in_(vals) for col, vals in conditions if vals]
    if not clauses:
        return []
    ids = _scalars(db, sa.select(table.c.id).where(sa.or_(*clauses)))
    for chunk in _chunks(ids):
        db.execute(sa.delete(table).where(table.c.id.in_(chunk)))
    return ids


def _pseudonymise_audit(db: Session, email: str, pseudonym: str) -> int:
    logs = _tables()["activity_logs"]
    rows = db.execute(sa.select(logs.c.id, logs.c.target, logs.c.details).where(sa.or_(
        sa.func.lower(logs.c.target) == email, sa.func.lower(logs.c.details).contains(email, autoescape=True)))).all()
    pattern = re.compile(re.escape(email), re.IGNORECASE)
    for row_id, target, details in rows:
        db.execute(sa.update(logs).where(logs.c.id == row_id).values(
            target=pattern.sub(pseudonym, target) if target else target,
            details=pattern.sub(pseudonym, details) if details else details))
    return len(rows)


def _check_no_orphans(db: Session, deleted: Dict[str, List[int]]) -> None:
    """Post-condition inside the transaction: nothing left anywhere still points at a row we removed."""
    for table_name, ids in deleted.items():
        if not ids:
            continue
        for col in _refs(table_name):
            if col.table.name == table_name:
                continue
            for chunk in _chunks(ids):
                left = db.execute(sa.select(sa.func.count()).select_from(col.table).where(col.in_(chunk))).scalar()
                if left:
                    raise StudentDeletionError(
                        "DEPENDENT_RECORDS", "This account still has records that depend on it, so nothing was deleted. "
                        f"({col.table.name}.{col.name})")


def delete_student(db: Session, *, user: models.User, actor_id: Optional[int], org_id: Optional[int]) -> Dict[str, Any]:
    """
    Deletes `user` (a STUDENT; the caller has already authorised the actor) and everything described in the module docstring.
    Commits on success, rolls back and re-raises on any failure. The caller must not use `user` afterwards.
    """
    if user.role != models.UserRole.STUDENT.value:
        raise StudentDeletionError("NOT_A_STUDENT", "Only Student accounts can be deleted.", 403)
    gaps = schema_gaps()
    if gaps:
        raise StudentDeletionError("UNHANDLED_REFERENCES", "This account cannot be deleted automatically because other tables "
                                   f"reference it without a deletion policy: {', '.join(gaps)}.")

    t = _tables()
    user_id, email = user.id, normalize_email(user.email)
    pseudonym = PSEUDONYM.format(id=user_id)
    members = db.query(models.OrganizationMember).filter(models.OrganizationMember.user_id == user_id).all()
    if any((m.role or "").upper() not in ("STUDENT", "") for m in members):
        raise StudentDeletionError("HAS_ADMIN_ROLE", "This account also holds an administrator role and cannot be deleted here.", 403)
    profile_row = db.execute(sa.select(t["student_profiles"].c.id).where(t["student_profiles"].c.user_id == user_id)).first()
    profile_id = profile_row[0] if profile_row else None
    # the ORM objects of the student must not be flushed or refreshed once their rows are gone
    for obj in [o for o in list(db.identity_map.values()) if getattr(o, "user_id", None) == user_id or o is user]:
        db.expunge(obj)

    try:
        reg_ids = _registration_ids(db, user_id)
        session_ids = _session_ids(db, user_id, profile_id, reg_ids)
        files = _file_paths(db, profile_id, user_id, session_ids)
        unlinked = _unlinked_email_records(db, email, user_id)
        users_before = int(db.execute(sa.select(sa.func.count()).select_from(t["users"])).scalar())

        # 1. what is deleted, per table
        plan: Dict[str, List[Tuple[str, List[Any]]]] = {}

        def add(table: str, column: str, values: List[Any]) -> None:
            if values:
                plan.setdefault(table, []).append((column, values))

        if profile_id is not None:
            for col in _refs("student_profiles"):
                add(col.table.name, col.name, [profile_id])
        for table, column in USER_OWNED:
            add(table, column, [user_id])
        for table, column in _SESSION_TABLES:
            add(table, column, session_ids)
        add("candidate_registrations", "id", reg_ids)
        add("users", "id", [user_id])

        # 2. detach the student from records that are kept (who-did-it pointers): activity_logs.user_id, created_by, invited_by ...
        detached: Dict[str, int] = {}
        for col in _refs("users"):
            if (col.table.name, col.name) in USER_OWNED:
                continue
            res = db.execute(sa.update(col.table).where(col == user_id).values({col.name: None}))
            if res.rowcount:
                detached[f"{col.table.name}.{col.name}"] = res.rowcount

        # 3. audit trail: keep every row, drop the identity from it
        audit_rows_pseudonymised = _pseudonymise_audit(db, email, pseudonym)

        # 4. delete, children before parents (matters wherever the database enforces foreign keys)
        deleted: Dict[str, List[int]] = {}
        for table in reversed(Base.metadata.sorted_tables):
            if table.name in plan:
                ids = _delete_rows(db, table, plan[table.name])
                if ids:
                    deleted[table.name] = ids

        # 5. post-conditions, still inside the transaction
        if deleted.get("users") != [user_id]:
            raise StudentDeletionError("NOT_DELETED", "The account could not be deleted. Nothing was changed.")
        if int(db.execute(sa.select(sa.func.count()).select_from(t["users"])).scalar()) != users_before - 1:
            raise StudentDeletionError("UNEXPECTED_ROW_COUNT", "Unexpected result while deleting the account. Nothing was changed.")
        _check_no_orphans(db, deleted)

        counts = {name: len(ids) for name, ids in sorted(deleted.items())}
        db.add(models.ActivityLog(
            user_id=actor_id, organization_id=org_id, action=DELETED_ACTION, target=pseudonym,
            details=json.dumps({"role": "STUDENT", "email_sha256": email_digest(email), "deleted_rows": counts,
                                "audit_rows_pseudonymised": audit_rows_pseudonymised, "detached_references": detached,
                                "files_to_remove": len(files), "unlinked_email_records_kept": unlinked}, sort_keys=True)))
        db.commit()
    except BaseException:
        db.rollback()
        raise
    db.expire_all()

    removed, failed = _remove_files(db, files)
    return {"user_id": user_id, "deleted_rows": counts, "total_rows_deleted": sum(counts.values()),
            "audit_rows_pseudonymised": audit_rows_pseudonymised, "detached_references": detached,
            "files_removed": removed, "files_failed": failed, "unlinked_email_records_kept": unlinked}


# ------------------------------------------------------------------------------ files
def _resolve_inside_media(raw: str) -> Optional[Path]:
    """The real path of an upload, only when it lies inside a media root (never follows a stored path out of it)."""
    p = Path(raw)
    bases = [None] if p.is_absolute() else [BACKEND_DIR, Path.cwd()]
    for base in bases:
        candidate = (p if base is None else base / p).resolve()
        for root in MEDIA_ROOTS:
            try:
                candidate.relative_to(root.resolve())
            except ValueError:
                continue
            return candidate
    return None


def _still_referenced(db: Session, raw: str) -> bool:
    t = _tables()
    names = {raw, Path(raw).as_posix(), Path(raw).name}
    for table, column in (("student_resumes", "file_path"), ("roleready_sessions", "resume_file_path")):
        col = t[table].c[column]
        if db.execute(sa.select(sa.func.count()).select_from(t[table]).where(col.in_(names))).scalar():
            return True
    return False


def _remove_files(db: Session, paths: Set[str]) -> Tuple[int, int]:
    """After the commit. A file another remaining row still points at is kept; failures are logged, never raised."""
    removed = failed = 0
    for raw in sorted(paths):
        target = _resolve_inside_media(raw)
        if target is None or not target.is_file():
            continue
        try:
            if _still_referenced(db, raw):
                continue
            target.unlink()
            removed += 1
        except OSError:
            failed += 1
            log.warning("could not remove a deleted student's upload: %s", target.name)
    return removed, failed
