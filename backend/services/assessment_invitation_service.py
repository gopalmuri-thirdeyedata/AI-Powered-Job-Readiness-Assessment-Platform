"""
E-mail invitations to a published assessment link (optional; copying the link by hand keeps working independently).

What this module does and does not do:
  * It e-mails the EXISTING shared link of a job role to students who already have an account. It never creates a student, a
    registration or an attempt, never extends or changes the 24 h link expiry, and never starts anything: recipients follow the
    normal link workflow (register once, single attempt).
  * Every (assessment, link, student) has one tracked row: PENDING -> SENT | FAILED. SENT means the SMTP server accepted the
    message, not that it reached an inbox, and the UI says so. A repeated request never re-sends a SENT row; FAILED rows (and
    PENDING rows abandoned by a crashed request) can be retried safely, and a claim is an atomic compare-and-set so two
    concurrent requests cannot both send.
"""
import logging
from dataclasses import dataclass
from datetime import timedelta
from html import escape
from typing import Dict, List, Optional

from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import models
from services import assessment_clock as clock
from services import assessment_policy as policy
from services import credential_delivery, email_service
from services import jd_blueprint_service as blueprint
from services import share_link_policy as link_policy

logger = logging.getLogger("prepwin.invitations")

PENDING, SENT, FAILED = "PENDING", "SENT", "FAILED"
STALE_PENDING = timedelta(minutes=5)   # a PENDING row older than this belongs to a request that died mid-send
MAX_RECIPIENTS_PER_REQUEST = 50        # bounds one request's SMTP time; the UI sends larger selections in chunks

SKIP_ALREADY_SENT = "Already sent for this link."
SKIP_IN_PROGRESS = "An invitation to this student is already being sent."


@dataclass(frozen=True)
class RenderedInvitation:
    subject: str
    html: str
    text: str


def format_expiry(expires_at) -> str:
    """Human wording of the link deadline; always UTC because the recipient's time zone is unknown."""
    exp = clock.aware(expires_at)
    if exp is None:
        return "This link has no fixed expiry date; it works until the hiring team closes the assessment."
    return f"This link expires on {exp.strftime('%d %b %Y at %H:%M')} UTC. Please complete your registration and start before then."


def _instructions() -> List[str]:
    return [
        f"The assessment has three timed sections, always in this order: Aptitude ({blueprint.APTITUDE_COUNT} multiple-choice questions), "
        f"Coding ({blueprint.CODING_COUNT} programming problems) and a voice-based AI Technical Interview ({blueprint.INTERVIEW_COUNT} questions).",
        f"Aptitude and Coding have a {policy.SECTION_MINUTES}-minute timer each, the Technical Interview has {policy.section_minutes('INTERVIEW')} minutes, and the whole assessment has a {policy.OVERALL_MINUTES}-minute limit. "
        "Nothing is timed until you select Start Assessment.",
        "You have one attempt. It cannot be paused or restarted.",
        "Use a laptop or desktop computer with a modern browser, a working camera and microphone, and a stable internet connection.",
        "Open the link, register with your details, read the full instructions and start when you are ready.",
    ]


def render_invitation(*, job_title: str, recipient_name: Optional[str], organization_name: Optional[str],
                      link_url: str, expires_at, login: Optional[credential_delivery.LoginInfo] = None) -> RenderedInvitation:
    """Professional HTML e-mail with a plain-text alternative. Every dynamic value is escaped in the HTML."""
    title = " ".join((job_title or "Assessment").split())
    name = " ".join((recipient_name or "").split())
    org = " ".join((organization_name or "").split())
    greeting = f"Hello {name}," if name else "Hello,"
    intro = (f"You have been invited by {org} to complete the online assessment for {title}." if org
             else f"You have been invited to complete the online assessment for {title}.")
    expiry = format_expiry(expires_at)
    steps = _instructions()
    subject = f"Invitation: {title} assessment"

    text = "\n".join([
        greeting, "", intro, "",
        "Start the assessment here:", link_url, "",
        expiry, "",
        *(credential_delivery.login_text_lines(login) + [""] if login else []),
        "Before you begin:", *[f"- {s}" for s in steps], "",
        "If the link does not open, copy it into your browser's address bar.",
        "If you were not expecting this invitation, you can ignore this e-mail.",
    ])

    items = "".join(f'<li style="margin:0 0 8px 0;">{escape(s)}</li>' for s in steps)
    safe_url = escape(link_url, quote=True)
    html = f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{escape(subject)}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
<tr><td style="background:#4c7324;padding:20px 28px;color:#ffffff;font-size:18px;font-weight:bold;">Assessment invitation</td></tr>
<tr><td style="padding:28px;font-size:15px;line-height:1.55;">
<p style="margin:0 0 14px 0;">{escape(greeting)}</p>
<p style="margin:0 0 14px 0;">{escape(intro)}</p>
<p style="margin:0 0 18px 0;font-size:17px;font-weight:bold;">{escape(title)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 18px 0;"><tr><td style="background:#5d8c2c;border-radius:8px;">
<a href="{safe_url}" style="display:inline-block;padding:12px 26px;color:#ffffff;font-weight:bold;font-size:15px;text-decoration:none;">Start the assessment</a>
</td></tr></table>
<p style="margin:0 0 18px 0;padding:10px 14px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;font-size:14px;">{escape(expiry)}</p>
{credential_delivery.login_html(login) if login else ""}
<p style="margin:0 0 8px 0;font-weight:bold;">Before you begin</p>
<ul style="margin:0 0 18px 0;padding-left:20px;font-size:14px;">{items}</ul>
<p style="margin:0 0 6px 0;font-size:13px;color:#475569;">If the button does not work, copy this link into your browser:</p>
<p style="margin:0 0 18px 0;font-size:13px;word-break:break-all;"><a href="{safe_url}" style="color:#4c7324;">{escape(link_url)}</a></p>
<p style="margin:0;font-size:12px;color:#64748b;">If you were not expecting this invitation, you can ignore this e-mail.</p>
</td></tr></table></td></tr></table></body></html>"""
    return RenderedInvitation(subject=subject, html=html, text=text)


# ------------------------------------------------------------------------------
# Tracking
# ------------------------------------------------------------------------------
def invitation_summary(row: Optional[models.AssessmentInvitation]) -> Optional[Dict]:
    """What the UI may see about a tracked invitation (never the link token)."""
    if row is None:
        return None
    ts = clock.aware(row.accepted_at if row.status == SENT else row.updated_at)
    return {"status": row.status, "attempts": row.attempts or 0, "error": row.last_error if row.status == FAILED else None,
            "updated_at": ts.isoformat() if ts else None}


def current_invitations(db: Session, job: models.JobDescription, student_ids: List[int]) -> Dict[int, models.AssessmentInvitation]:
    """Tracked rows of the job's CURRENT link, keyed by student id (a renewed link starts a fresh slate)."""
    if not job.share_token or not student_ids:
        return {}
    rows = db.query(models.AssessmentInvitation).filter(
        models.AssessmentInvitation.job_description_id == job.id,
        models.AssessmentInvitation.share_token == job.share_token,
        models.AssessmentInvitation.student_user_id.in_(student_ids),
    ).all()
    return {r.student_user_id: r for r in rows}


def student_display_name(db: Session, user: models.User) -> Optional[str]:
    if user.full_name:
        return user.full_name
    profile = db.query(models.StudentProfile.full_name).filter(models.StudentProfile.user_id == user.id).first()
    return profile[0] if profile else None


def _claim(db: Session, job, student, invited_by: Optional[int], now) -> Optional[models.AssessmentInvitation]:
    """
    Returns the row to send for, or None when this request must not send (already SENT, or another request holds it).
    Creating the row and the FAILED/stale -> PENDING transition are both single atomic statements (unique key / compare-and-set).
    """
    now_db = clock.naive_utc(now)
    row = db.query(models.AssessmentInvitation).filter_by(
        job_description_id=job.id, student_user_id=student.id, share_token=job.share_token).first()
    if row is None:
        row = models.AssessmentInvitation(
            job_description_id=job.id, organization_id=job.organization_id, student_user_id=student.id,
            share_token=job.share_token, recipient_email=student.email, status=PENDING, attempts=1,
            invited_by=invited_by, updated_at=now_db)
        db.add(row)
        try:
            db.commit()
        except IntegrityError:  # a concurrent request created it first
            db.rollback()
            return None
        db.refresh(row)
        return row
    if row.status == SENT:
        return None
    if row.status == PENDING and row.updated_at is not None and clock.aware(row.updated_at) > now - STALE_PENDING:
        return None
    won = db.execute(
        update(models.AssessmentInvitation)
        .where(models.AssessmentInvitation.id == row.id,
               models.AssessmentInvitation.status == row.status,
               models.AssessmentInvitation.attempts == row.attempts)
        .values(status=PENDING, attempts=(row.attempts or 0) + 1, updated_at=now_db, last_error=None,
                recipient_email=student.email, invited_by=invited_by)
    ).rowcount
    db.commit()
    if won != 1:
        return None
    db.refresh(row)
    return row


def _finish(db: Session, row: models.AssessmentInvitation, status: str, error: Optional[str], now) -> None:
    row.status = status
    row.last_error = (error or None) and error[:255]
    row.updated_at = clock.naive_utc(now)
    if status == SENT:
        row.accepted_at = clock.naive_utc(now)
    db.commit()


def send_invitations(db: Session, *, job: models.JobDescription, students: List[models.User], link_url: str,
                     organization_name: Optional[str], invited_by: Optional[int]) -> List[Dict]:
    """
    Sends one invitation per student and returns one result per student, in order:
        {"student_id", "email", "name", "status": "sent" | "failed" | "skipped", "reason", "attempts"}
    Raises email_service.EmailNotConfigured BEFORE anything is claimed or tracked. A connect/TLS/auth failure aborts the rest of
    the batch (they would all fail identically); those recipients are recorded FAILED ("Not attempted") so they can be retried.
    """
    settings = email_service.load_settings()
    results: List[Dict] = []
    abort_reason: Optional[str] = None

    for student in students:
        name = student_display_name(db, student)
        base = {"student_id": student.id, "email": student.email, "name": name}
        now = clock.now()
        row = _claim(db, job, student, invited_by, now)
        if row is None:
            existing = db.query(models.AssessmentInvitation).filter_by(
                job_description_id=job.id, student_user_id=student.id, share_token=job.share_token).first()
            already = existing is not None and existing.status == SENT
            results.append({**base, "status": "skipped", "reason": SKIP_ALREADY_SENT if already else SKIP_IN_PROGRESS,
                            "attempts": existing.attempts if existing else 0})
            continue

        if abort_reason:
            _finish(db, row, FAILED, f"Not attempted: {abort_reason}", now)
            results.append({**base, "status": "failed", "reason": row.last_error, "attempts": row.attempts})
            continue

        login = credential_delivery.login_info(db, student)      # read-only: login ID, login page, and the password only if still retained
        rendered = render_invitation(job_title=job.title, recipient_name=name, organization_name=organization_name,
                                     link_url=link_url, expires_at=job.share_link_expires_at, login=login)
        try:
            email_service.send(settings, student.email, rendered.subject, rendered.html, rendered.text, to_name=name)
        except email_service.EmailSystemError as exc:
            abort_reason = str(exc)
            _finish(db, row, FAILED, abort_reason, clock.now())
            results.append({**base, "status": "failed", "reason": abort_reason, "attempts": row.attempts})
        except email_service.EmailRecipientError as exc:
            _finish(db, row, FAILED, str(exc), clock.now())
            results.append({**base, "status": "failed", "reason": str(exc), "attempts": row.attempts})
        except Exception:  # never let one unexpected error hide the other recipients' outcomes or leak internals
            logger.exception("Unexpected error while sending an invitation (job %s, student %s)", job.id, student.id)
            _finish(db, row, FAILED, "Unexpected error while sending this invitation.", clock.now())
            results.append({**base, "status": "failed", "reason": row.last_error, "attempts": row.attempts})
        else:
            _finish(db, row, SENT, None, clock.now())
            if login is not None and login.password:
                credential_delivery.discard(db, student.id)    # the mail server accepted it: the temporary retained copy is gone, as after Share
                db.commit()
            results.append({**base, "status": "sent", "reason": None, "attempts": row.attempts})
    return results


def link_problem(job: models.JobDescription) -> Optional[Dict]:
    """None when the job's link is live; otherwise the HTTP status and message explaining why invitations cannot go out."""
    state = link_policy.link_state(job, clock.now())
    if state == link_policy.ACTIVE:
        return None
    if state == link_policy.EXPIRED:
        return {"status": 410, "message": "The shared link has expired. Create a new link before sending invitations."}
    if state == link_policy.CLOSED:
        return {"status": 409, "message": "This assessment is closed. Reopen it before sending invitations."}
    return {"status": 409, "message": "Publish this assessment first to get its shared link."}
