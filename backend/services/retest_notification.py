"""
The e-mail that tells a candidate a section retest was assigned (one e-mail per assignment, listing every assigned section).

It reuses the platform's one SMTP layer (services.email_service: the same SMTP_* settings, sender and typed errors) and the tracking
pattern of the assessment invitations: every retest row carries PENDING -> SENT | FAILED, an atomic compare-and-set claim lets only one
request send at a time, SENT is never re-sent, and FAILED (or a PENDING abandoned by a crashed request) can be retried safely.

Assignment and notification are tracked separately: the assignment is committed BEFORE any mail is attempted, a mail failure never
removes or alters it, and SENT is recorded only after the SMTP server accepted the message.

What the e-mail carries: the candidate's name, the job role, the assigned section(s), the optional reason, the expiry and one
"Start Retest" link per section. The link is /assessment/retest/<retest id>, plus ?token=<single-use token> for an accountless
registration (the only credential such a candidate has; it is stored hashed and rotated whenever the mail is retried). A student never
gets a token: opening the link requires their own signed-in session. Never included: passwords, session or lease tokens, answers, scores.
"""
import logging
import os
import secrets
from dataclasses import dataclass
from datetime import timedelta
from html import escape
from typing import Dict, List, Optional
from urllib.parse import quote

from email_validator import EmailNotValidError, validate_email
from sqlalchemy import update
from sqlalchemy.orm import Session

import models
import utils
from services import assessment_clock as clock
from services import assessment_flow_service as flow
from services import credential_delivery
from services import email_service

logger = logging.getLogger("prepwin.retest_notification")

PENDING, SENT, FAILED = "PENDING", "SENT", "FAILED"
STALE_PENDING = timedelta(minutes=5)      # a claim older than this belongs to a request that died mid-send
SUBJECT = "Retest Assigned — PrepWin Assessment"
_LOCAL_HOSTS = ("localhost", "127.0.0.1", "0.0.0.0", "[::1]")


@dataclass(frozen=True)
class RenderedRetestEmail:
    subject: str
    html: str
    text: str


class LinkNotConfigured(Exception):
    """FRONTEND_URL points at this machine in production: a mailed link would be useless to the candidate."""


def base_url() -> str:
    base = (os.getenv("FRONTEND_URL", "http://localhost:5173") or "").rstrip("/")
    host = base.split("://", 1)[-1].split("/", 1)[0].split(":")[0]
    if utils.is_production() and (not base or host in _LOCAL_HOSTS):
        raise LinkNotConfigured("The public application URL (FRONTEND_URL) is not configured for production, so the retest link would not work.")
    return base


def retest_path(retest_uuid: str, token: Optional[str] = None) -> str:
    return f"/assessment/retest/{retest_uuid}" + (f"?token={quote(token, safe='')}" if token else "")


def format_expiry(expires_at) -> str:
    exp = clock.aware(expires_at)
    return exp.strftime("%d %b %Y at %H:%M") + " UTC" if exp else "the date given by the hiring team"


def render(*, candidate_name: Optional[str], job_title: str, items: List[Dict[str, str]], reason: Optional[str], expires_at,
           login: Optional[credential_delivery.LoginInfo] = None) -> RenderedRetestEmail:
    """items: [{"label": "Coding", "url": "https://.../assessment/retest/..."}]. Every dynamic value is escaped in the HTML."""
    name = " ".join((candidate_name or "").split())
    title = " ".join((job_title or "Assessment").split())
    reason = " ".join((reason or "").split())
    greeting = f"Hello {name}," if name else "Hello,"
    labels = ", ".join(i["label"] for i in items)
    expiry = format_expiry(expires_at)
    many = len(items) > 1
    plural = "sections" if many else "section"

    lines = [greeting, "", "A retest has been assigned to you for your assessment on PrepWin.", "",
             "Assessment details", f"- Job Role: {title}", f"- Assigned Section(s): {labels}"]
    if reason:
        lines.append(f"- Reason: {reason}")
    lines += [f"- Retest Valid Until: {expiry}", "",
              "Use the link below to access your assigned retest." if not many else "Use the links below to access your assigned retests (one per section).", ""]
    lines += [f"Start Retest{' — ' + i['label'] if many else ''}: {i['url']}" for i in items]
    if login:
        lines += [""] + credential_delivery.login_text_lines(login)
    lines += ["", f"Please complete the assigned {plural} within the validity period.", "",
              f"Only the {plural} listed in this email {'are' if many else 'is'} authorized for retesting. Your other assessment results will remain unchanged.",
              "If the link does not open, copy it into your browser's address bar. If you were not expecting this e-mail, you can ignore it.",
              "", "Regards,", "PrepWin Assessment Team"]
    text = "\n".join(lines)

    buttons = "".join(
        f'<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 12px 0;"><tr><td style="background:#5d8c2c;border-radius:8px;">'
        f'<a href="{escape(i["url"], quote=True)}" style="display:inline-block;padding:12px 26px;color:#ffffff;font-weight:bold;font-size:15px;text-decoration:none;">'
        f'Start Retest{escape(" — " + i["label"]) if many else ""}</a></td></tr></table>' for i in items)
    reason_row = f'<li style="margin:0 0 6px 0;"><b>Reason:</b> {escape(reason)}</li>' if reason else ""
    html = f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{escape(SUBJECT)}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
<tr><td style="background:#4c7324;padding:20px 28px;color:#ffffff;font-size:18px;font-weight:bold;">Retest assigned</td></tr>
<tr><td style="padding:28px;font-size:15px;line-height:1.55;">
<p style="margin:0 0 14px 0;">{escape(greeting)}</p>
<p style="margin:0 0 14px 0;">A retest has been assigned to you for your assessment on PrepWin.</p>
<p style="margin:0 0 6px 0;font-weight:bold;">Assessment details</p>
<ul style="margin:0 0 18px 0;padding-left:20px;font-size:14px;">
<li style="margin:0 0 6px 0;"><b>Job Role:</b> {escape(title)}</li>
<li style="margin:0 0 6px 0;"><b>Assigned Section(s):</b> {escape(labels)}</li>
{reason_row}
<li style="margin:0 0 6px 0;"><b>Retest Valid Until:</b> {escape(expiry)}</li>
</ul>
<p style="margin:0 0 12px 0;">{'Use the buttons below to access your assigned retests (one per section).' if many else 'Use the button below to access your assigned retest.'}</p>
{buttons}
{credential_delivery.login_html(login) if login else ""}
<p style="margin:6px 0 14px 0;">Please complete the assigned {plural} within the validity period.</p>
<p style="margin:0 0 14px 0;padding:10px 14px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;font-size:14px;">Only the {plural} listed in this email {'are' if many else 'is'} authorized for retesting. Your other assessment results will remain unchanged.</p>
<p style="margin:0 0 18px 0;font-size:12px;color:#64748b;">If a button does not work, copy its link into your browser. If you were not expecting this e-mail, you can ignore it.</p>
<p style="margin:0;">Regards,<br>PrepWin Assessment Team</p>
</td></tr></table></td></tr></table></body></html>"""
    return RenderedRetestEmail(subject=SUBJECT, html=html, text=text)


# ------------------------------------------------------------------------------ tracking
def summary(rows: List[models.AssessmentRetest]) -> Dict:
    """What the administrator sees about a batch's e-mail (never a link or a token)."""
    first = rows[0]
    ts = clock.aware(first.email_sent_at)
    return {"status": first.email_status, "to": first.email_recipient, "attempts": first.email_attempts or 0,
            "error": first.email_last_error if first.email_status == FAILED else None, "sent_at": ts.isoformat() if ts else None}


def _batch_rows(db: Session, batch: str, awaiting_only: bool = False) -> List[models.AssessmentRetest]:
    """Every retest assigned together; `awaiting_only` keeps those still waiting for the candidate (a cancelled one is not mailed about)."""
    q = db.query(models.AssessmentRetest).filter(models.AssessmentRetest.notify_batch == batch)
    if awaiting_only:
        q = q.filter(models.AssessmentRetest.status == "ASSIGNED")
    return q.populate_existing().order_by(models.AssessmentRetest.id).all()


def _claim(db: Session, batch: str, now) -> bool:
    """
    Atomic compare-and-set over the whole batch: only retests still awaiting the candidate (ASSIGNED) whose mail is FAILED, or PENDING
    and not being sent right now, move to PENDING under this request. A SENT mail, or one another request is sending, is never claimed.
    """
    now_db = clock.naive_utc(now)
    rows = _batch_rows(db, batch, awaiting_only=True)
    claimable = [r for r in rows if r.email_status == FAILED or (
        r.email_status == PENDING and (r.email_claimed_at is None or clock.aware(r.email_claimed_at) < now - STALE_PENDING))]
    if not rows or len(claimable) != len(rows):
        db.rollback()
        return False
    won = 0
    for r in rows:
        won += db.execute(
            update(models.AssessmentRetest)
            .where(models.AssessmentRetest.id == r.id, models.AssessmentRetest.status == "ASSIGNED",
                   models.AssessmentRetest.email_status == r.email_status, models.AssessmentRetest.email_attempts == r.email_attempts)
            .values(email_status=PENDING, email_attempts=(r.email_attempts or 0) + 1, email_claimed_at=now_db, email_last_error=None)
        ).rowcount
    if won != len(rows):
        db.rollback()
        return False
    db.commit()
    return True


def _finish(db: Session, batch: str, status: str, error: Optional[str], to: Optional[str], now) -> None:
    for r in _batch_rows(db, batch, awaiting_only=True):
        r.email_status = status
        r.email_last_error = (error or None) and error[:255]
        r.email_claimed_at = None
        if to:
            r.email_recipient = to
        if status == SENT:
            r.email_sent_at = clock.naive_utc(now)
    db.commit()


def deliver(db: Session, batch: str, tokens: Optional[Dict[str, str]] = None) -> Dict:
    """
    Sends (or retries) the e-mail of one assignment batch. `tokens` maps retest uuid -> the raw single-use token of an accountless
    registration, known only at assignment; on a retry the tokens are rotated (only a hash is ever stored) and returned in
    "tokens" so the administrator has a manual fallback. Returns {"status": "sent" | "failed" | "skipped", "reason", "tokens", "email"}.
    """
    now = clock.now()
    if not _claim(db, batch, now):
        waiting = _batch_rows(db, batch, awaiting_only=True)
        reason = ("The retest is no longer waiting for the candidate." if not waiting
                  else "This e-mail was already sent." if waiting[0].email_status == SENT else "This e-mail is already being sent.")
        everything = _batch_rows(db, batch)
        out = {"status": "skipped", "reason": reason, "tokens": {}, "email": summary(waiting or everything) if everything else None}
        db.rollback()
        return out

    rows = _batch_rows(db, batch, awaiting_only=True)
    reg = db.query(models.CandidateRegistration).filter(models.CandidateRegistration.id == rows[0].registration_id).first()
    job = db.query(models.JobDescription).filter(models.JobDescription.id == rows[0].job_description_id).first()
    to = (reg.email if reg else "") or ""

    # accountless candidates: a fresh single-use token for every retest we (re)send, stored hashed
    live: Dict[str, str] = dict(tokens or {})
    if reg is not None and reg.student_user_id is None:
        for r in rows:
            if r.retest_uuid not in live:
                live[r.retest_uuid] = secrets.token_urlsafe(32)
                r.access_token_hash = flow.sha256_hex(live[r.retest_uuid])
        db.commit()

    def fail(message: str) -> Dict:
        _finish(db, batch, FAILED, message, to, clock.now())
        return {"status": "failed", "reason": message, "tokens": live, "email": summary(_batch_rows(db, batch, awaiting_only=True))}

    try:
        validate_email(to.strip(), check_deliverability=False)
    except EmailNotValidError:
        return fail("The candidate's registered e-mail address is not valid.")
    try:
        base = base_url()
        settings = email_service.load_settings()
    except (LinkNotConfigured, email_service.EmailNotConfigured) as exc:
        return fail(str(exc))

    student = db.query(models.User).filter(models.User.id == reg.student_user_id).first() if reg is not None and reg.student_user_id else None
    login = credential_delivery.login_info(db, student)           # students only; read-only (nothing is generated or reset)
    rendered = render(candidate_name=reg.name if reg else None, job_title=job.title if job else "Assessment",
                      items=[{"label": flow.SECTION_LABELS[r.section], "url": base + retest_path(r.retest_uuid, live.get(r.retest_uuid))} for r in rows],
                      reason=rows[0].reason, expires_at=rows[0].expires_at, login=login)
    try:
        email_service.send(settings, to, rendered.subject, rendered.html, rendered.text, to_name=reg.name if reg else None)
    except (email_service.EmailSystemError, email_service.EmailRecipientError) as exc:
        return fail(str(exc))
    except Exception:  # never leak internals, never leave the batch PENDING
        logger.exception("Unexpected error while sending a retest e-mail (batch %s)", batch)
        return fail("Unexpected error while sending this e-mail.")
    _finish(db, batch, SENT, None, to, clock.now())
    if login is not None and login.password:
        credential_delivery.discard(db, student.id)               # accepted by the mail server: the temporary retained copy is gone, as after Share
        db.commit()
    return {"status": "sent", "reason": None, "tokens": {}, "email": summary(_batch_rows(db, batch, awaiting_only=True))}
