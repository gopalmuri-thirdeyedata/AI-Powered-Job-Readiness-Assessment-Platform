"""
"Share credentials": e-mail a student the login e-mail and the password an administrator assigned.

A stored password is a bcrypt hash and cannot be recovered, so the only password that can ever be shared is one the server was
handed a moment ago: at account creation or at "Replace password". That password is kept, for a short time only, in an ENCRYPTED
record (models.CredentialDelivery) so that the administrator can press Share afterwards. Rules enforced here, not by convention:

  * Never plaintext at rest: Fernet (AES-128-CBC + HMAC) with a key derived from the server secret (JWT_SECRET_KEY) or set explicitly
    in CREDENTIAL_DELIVERY_KEY. The ciphertext is bound to the student's id, so a swapped row cannot deliver another student's password.
  * Short-lived: CREDENTIAL_SHARE_TTL_MINUTES (default 120; 0 disables retention, so Share is never available). Expired rows are deleted.
  * Only retained when e-mail can actually be sent (SMTP configured); otherwise nothing is kept.
  * Deleted as soon as the SMTP server has accepted the message, when the student changes their password, and on expiry.
  * Never sent blindly: right before sending, the decrypted password is checked against the account's current hash. A mismatch
    (password changed meanwhile, tampering) deletes the record and nothing is sent.
  * One send at a time per student (atomic claim), so a double click or a second admin cannot e-mail twice.
  * Nothing here logs a password, a ciphertext or a message body; audit rows say who, which account and the outcome only.
  * Sharing never changes a password. A failed delivery leaves the account exactly as it was (and the record for a retry until expiry).
"""
import base64
import json
import logging
import os
from dataclasses import dataclass, field
from datetime import timedelta
from html import escape
from typing import Dict, Optional, Set, Tuple

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from sqlalchemy import update
from sqlalchemy.orm import Session

import models
import utils
from services import assessment_clock as clock
from services import email_service

logger = logging.getLogger("prepwin.credentials")

DEFAULT_TTL_MINUTES = 120
CLAIM_STALE = timedelta(minutes=2)          # a claim older than this belongs to a request that died mid-send
SUBJECT = "Your PrepWin Student Login Credentials"

NOT_AVAILABLE = ("PASSWORD_NOT_AVAILABLE",
                 "This student's password cannot be recovered or shown, so it cannot be e-mailed from here. "
                 "Use Replace password to set a new one, then click Share.")


class CredentialShareError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


# ------------------------------------------------------------------------------ encryption
def ttl() -> timedelta:
    raw = (os.getenv("CREDENTIAL_SHARE_TTL_MINUTES") or "").strip()
    try:
        minutes = int(raw) if raw else DEFAULT_TTL_MINUTES
    except ValueError:
        minutes = DEFAULT_TTL_MINUTES
    return timedelta(minutes=max(0, min(minutes, 24 * 60)))


def _fernet() -> Fernet:
    explicit = (os.getenv("CREDENTIAL_DELIVERY_KEY") or "").strip()
    if explicit:
        return Fernet(explicit.encode())
    key = HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=b"prepwin-credential-delivery").derive(utils.get_secret_key().encode())
    return Fernet(base64.urlsafe_b64encode(key))


def _seal(user_id: int, password: str) -> str:
    return _fernet().encrypt(json.dumps({"u": user_id, "p": password}).encode()).decode()


def _open(user_id: int, token: str) -> Optional[str]:
    try:
        data = json.loads(_fernet().decrypt(token.encode(), ttl=int(ttl().total_seconds()) or 1))
    except (InvalidToken, ValueError):
        return None
    return data.get("p") if isinstance(data, dict) and data.get("u") == user_id and isinstance(data.get("p"), str) else None


# ------------------------------------------------------------------------------ retention
def purge_expired(db: Session) -> None:
    db.query(models.CredentialDelivery).filter(models.CredentialDelivery.expires_at <= clock.naive_utc(clock.now())).delete(synchronize_session=False)


def discard(db: Session, user_id: int) -> None:
    """Forget any retained password of this student (their password changed, so it is no longer the assigned one)."""
    db.query(models.CredentialDelivery).filter(models.CredentialDelivery.user_id == user_id).delete(synchronize_session=False)


def retain(db: Session, user: models.User, password: str, actor_id: Optional[int]) -> bool:
    """
    Keeps `password` (encrypted, short-lived) so it can be shared. The caller commits, in the same transaction that set the password.
    Returns False, keeping nothing, when retention is disabled or e-mail could not be sent anyway.
    """
    if user.role != models.UserRole.STUDENT.value:
        return False
    discard(db, user.id)                       # a newer password always replaces the previous record
    if ttl().total_seconds() <= 0 or not email_service.is_configured():
        return False
    purge_expired(db)
    db.add(models.CredentialDelivery(
        user_id=user.id, organization_id=user.organization_id, ciphertext=_seal(user.id, password), created_by=actor_id,
        expires_at=clock.naive_utc(clock.now() + ttl()), attempts=0))
    return True


def ready_user_ids(db: Session, user_ids) -> Set[int]:
    """Which of these students currently have a shareable (retained, unexpired) password. Never reveals anything else."""
    user_ids = list(user_ids)
    if not user_ids:
        return set()
    rows = db.query(models.CredentialDelivery.user_id).filter(
        models.CredentialDelivery.user_id.in_(user_ids), models.CredentialDelivery.expires_at > clock.naive_utc(clock.now())).all()
    return {r[0] for r in rows}


# ------------------------------------------------------------------------------ e-mail
def login_url() -> str:
    base = (os.getenv("FRONTEND_URL", "http://localhost:5173") or "").rstrip("/")
    host = base.split("://", 1)[-1].split("/", 1)[0].split(":")[0]
    if utils.is_production() and (not base or host in ("localhost", "127.0.0.1", "0.0.0.0", "[::1]")):
        raise CredentialShareError(503, "FRONTEND_URL_NOT_CONFIGURED",
                                   "The public application URL (FRONTEND_URL) is not configured for production, so the login link would not work.")
    return f"{base}/student/login"


RECOMMENDED_SITES_HEADING = "Recommended Websites"
RECOMMENDED_SITES_INTRO = "We also recommend exploring the following platforms to enhance your learning and interview preparation:"
RECOMMENDED_SITES_OUTRO = "Visit these websites to explore the available learning resources and interview preparation opportunities."
RECOMMENDED_SITES = (("Neev Learning Platform", "https://neev.learningpath.ai/"),
                     ("Interviewer Platform", "https://interviewer.learningpath.ai/"))


@dataclass(frozen=True)
class RenderedCredentials:
    subject: str
    html: str
    text: str


def render_email(*, student_name: Optional[str], student_email: str, password: str, url: str) -> RenderedCredentials:
    """HTML + plain-text credentials e-mail. Every dynamic value is escaped in the HTML; nothing is left as a placeholder."""
    name = " ".join((student_name or "").split()) or "Student"
    steps = ["Open the PrepWin Student Login page.", "Enter your registered email address.",
             "Enter the password provided in this email.", "Click Login to access your student account."]
    text = "\n".join([
        f"Hello {name},", "", "Your PrepWin student account is ready.", "", "Your login details are:", "",
        f"Login Email: {student_email}", f"Password: {password}", f"Student Login: {url}", "",
        "How to log in", *[f"{i}. {s}" for i, s in enumerate(steps, 1)], "",
        "Keep your login credentials private.", "",
        RECOMMENDED_SITES_HEADING, "", RECOMMENDED_SITES_INTRO, "",
        *[f"- {site}: {site_url}" for site, site_url in RECOMMENDED_SITES], "",
        RECOMMENDED_SITES_OUTRO, "", "Regards,", "PrepWin Team"])
    items = "".join(f'<li style="margin:0 0 6px 0;">{escape(s)}</li>' for s in steps)
    sites = "".join(f'<li style="margin:0 0 6px 0;">{escape(site)}: <a href="{escape(site_url, quote=True)}" style="color:#4c7324;word-break:break-all;">{escape(site_url)}</a></li>'
                    for site, site_url in RECOMMENDED_SITES)
    html = f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{escape(SUBJECT)}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
<tr><td style="background:#4c7324;padding:20px 28px;color:#ffffff;font-size:20px;font-weight:bold;">PrepWin</td></tr>
<tr><td style="padding:28px;font-size:15px;line-height:1.55;">
<p style="margin:0 0 14px 0;">Hello {escape(name)},</p>
<p style="margin:0 0 14px 0;">Your PrepWin student account is ready.</p>
<p style="margin:0 0 8px 0;font-weight:bold;">Your login details are:</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 18px 0;width:100%;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
<tr><td style="padding:12px 16px;font-size:14px;"><div style="color:#64748b;font-size:12px;">Login Email</div><div style="font-weight:bold;word-break:break-all;">{escape(student_email)}</div></td></tr>
<tr><td style="padding:0 16px 12px 16px;font-size:14px;"><div style="color:#64748b;font-size:12px;">Password</div><div style="font-family:Consolas,Menlo,monospace;font-weight:bold;font-size:16px;word-break:break-all;">{escape(password)}</div></td></tr>
</table>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 18px 0;"><tr><td style="background:#5d8c2c;border-radius:8px;">
<a href="{escape(url, quote=True)}" style="display:inline-block;padding:12px 26px;color:#ffffff;font-weight:bold;font-size:15px;text-decoration:none;">Open PrepWin Student Login</a>
</td></tr></table>
<p style="margin:0 0 6px 0;font-size:13px;color:#475569;">Student Login: <a href="{escape(url, quote=True)}" style="color:#4c7324;">{escape(url)}</a></p>
<p style="margin:18px 0 8px 0;font-weight:bold;">How to log in</p>
<ol style="margin:0 0 18px 0;padding-left:20px;font-size:14px;">{items}</ol>
<p style="margin:0 0 18px 0;padding:10px 14px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;font-size:14px;">Keep your login credentials private.</p>
<p style="margin:0 0 8px 0;font-weight:bold;">{escape(RECOMMENDED_SITES_HEADING)}</p>
<p style="margin:0 0 8px 0;font-size:14px;">{escape(RECOMMENDED_SITES_INTRO)}</p>
<ul style="margin:0 0 12px 0;padding-left:20px;font-size:14px;">{sites}</ul>
<p style="margin:0 0 18px 0;font-size:14px;">{escape(RECOMMENDED_SITES_OUTRO)}</p>
<p style="margin:0;">Regards,<br>PrepWin Team</p>
</td></tr></table></td></tr></table></body></html>"""
    return RenderedCredentials(subject=SUBJECT, html=html, text=text)


# ------------------------------------------------------------------------------ login details for assignment e-mails
PASSWORD_NOT_INCLUDED = ("Your password was set by your administrator and is not included in this e-mail. If you do not have it, "
                         "ask your administrator to set a new password for you (\"Replace password\").")


@dataclass(frozen=True)
class LoginInfo:
    """What a test / retest e-mail tells a student about logging in. `password` is set only when the assigned password is still retained."""
    login_id: str
    url: Optional[str]
    password: Optional[str] = field(default=None, repr=False)     # never shown in a repr / log line


def login_info(db: Session, user: Optional[models.User]) -> Optional[LoginInfo]:
    """
    The login details to add to an assignment e-mail for a STUDENT account (None for anything else, e.g. an accountless candidate).
    Read-only: nothing is generated, reset, retained or deleted here. The password is included only if the encrypted, short-lived record
    of the assigned password is still valid AND is still the account's current password (checked against the stored hash); otherwise
    the e-mail carries the login ID, the login page and the existing way to get a new password (an administrator's Replace password).
    A stored hash is never exposed.
    """
    if user is None or user.role != models.UserRole.STUDENT.value or not user.email:
        return None
    try:
        url: Optional[str] = login_url()
    except CredentialShareError:
        url = None
    password: Optional[str] = None
    row = db.query(models.CredentialDelivery).filter(
        models.CredentialDelivery.user_id == user.id, models.CredentialDelivery.expires_at > clock.naive_utc(clock.now())).first()
    if row is not None:
        candidate = _open(user.id, row.ciphertext)
        if candidate is not None and utils.verify_password(candidate, user.hashed_password):
            password = candidate
    return LoginInfo(login_id=user.email, url=url, password=password)


def login_text_lines(info: LoginInfo) -> list:
    """Plain-text lines of the "Your login details" block (shared by the test and retest e-mails)."""
    lines = ["Your login details:", f"- Login ID (your registered e-mail): {info.login_id}"]
    lines.append(f"- Password: {info.password}" if info.password else f"- Password: {PASSWORD_NOT_INCLUDED}")
    if info.url:
        lines.append(f"- Student login page: {info.url}")
    return lines


def login_html(info: LoginInfo) -> str:
    """The same block as an HTML table. Every value is escaped."""
    rows = [("Login ID (your registered e-mail)", f'<span style="font-weight:bold;word-break:break-all;">{escape(info.login_id)}</span>')]
    rows.append(("Password", f'<span style="font-family:Consolas,Menlo,monospace;font-weight:bold;word-break:break-all;">{escape(info.password)}</span>'
                 if info.password else f'<span style="color:#475569;">{escape(PASSWORD_NOT_INCLUDED)}</span>'))
    if info.url:
        rows.append(("Student login page", f'<a href="{escape(info.url, quote=True)}" style="color:#4c7324;word-break:break-all;">{escape(info.url)}</a>'))
    cells = "".join(f'<tr><td style="padding:8px 14px;font-size:14px;"><div style="color:#64748b;font-size:12px;">{escape(k)}</div><div>{v}</div></td></tr>' for k, v in rows)
    return ('<p style="margin:0 0 8px 0;font-weight:bold;">Your login details</p>'
            '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 18px 0;width:100%;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">'
            f'{cells}</table>')


# ------------------------------------------------------------------------------ sending
def _audit(db: Session, actor_id: int, org_id: Optional[int], user: models.User, outcome: str) -> None:
    """Who, which account, what happened. Never the password, never the message."""
    db.add(models.ActivityLog(user_id=actor_id, organization_id=org_id, action=f"CREDENTIALS_SHARE_{outcome}", target=user.email,
                              details=f"student_user_id={user.id}"))


def send_credentials(db: Session, *, user: models.User, actor_id: int, org_id: Optional[int]) -> Dict[str, str]:
    """
    Sends the retained credentials of `user` (an active STUDENT of the caller's organization; checked by the router).
    Raises CredentialShareError for every refusal / failure, with a message that is safe to show. The account is never modified.
    """
    purge_expired(db)
    db.commit()
    try:
        settings = email_service.load_settings()          # missing / invalid SMTP: nothing claimed, the record stays
    except email_service.EmailNotConfigured as exc:
        raise CredentialShareError(503, "EMAIL_NOT_CONFIGURED", str(exc))
    url = login_url()

    row = db.query(models.CredentialDelivery).filter(models.CredentialDelivery.user_id == user.id).first()
    if row is None:
        raise CredentialShareError(409, *NOT_AVAILABLE)
    now = clock.now()
    now_db = clock.naive_utc(now)
    claimed = db.execute(
        update(models.CredentialDelivery)
        .where(models.CredentialDelivery.id == row.id, models.CredentialDelivery.expires_at > now_db,
               (models.CredentialDelivery.sending_at.is_(None)) | (models.CredentialDelivery.sending_at < clock.naive_utc(now - CLAIM_STALE)))
        .values(sending_at=now_db, attempts=models.CredentialDelivery.attempts + 1)
    ).rowcount
    db.commit()
    if claimed != 1:
        raise CredentialShareError(409, "SEND_IN_PROGRESS", "These credentials are already being sent. Please wait a moment.")
    db.refresh(row)

    password = _open(user.id, row.ciphertext)
    if password is None or not utils.verify_password(password, user.hashed_password):
        # unreadable, expired, tampered with, or no longer the account's password: never send it
        db.delete(row)
        db.commit()
        raise CredentialShareError(409, *NOT_AVAILABLE)

    rendered = render_email(student_name=user.full_name, student_email=user.email, password=password, url=url)
    failure: Optional[Tuple[int, str, str, str]] = None
    try:
        email_service.send(settings, user.email, rendered.subject, rendered.html, rendered.text, to_name=user.full_name)
    except email_service.EmailSystemError as exc:
        failure = (502, "EMAIL_UNAVAILABLE", f"{exc} Nothing was changed; you can try again.", str(exc))
    except email_service.EmailRecipientError as exc:
        failure = (502, "EMAIL_REJECTED", f"{exc} Nothing was changed; you can try again.", str(exc))
    except Exception as exc:   # never leak internals, never log anything that could hold the password
        logger.error("Unexpected failure while sharing credentials (student %s): %s", user.id, type(exc).__name__)
        failure = (502, "EMAIL_FAILED", "The e-mail could not be sent. Nothing was changed; you can try again.", "Unexpected error.")
    finally:
        del password, rendered

    row = db.query(models.CredentialDelivery).filter(models.CredentialDelivery.id == row.id).first()
    if failure is not None:
        if row is not None:
            row.sending_at = None
            row.last_error = failure[3][:255]
        _audit(db, actor_id, org_id, user, "FAILED")
        db.commit()
        raise CredentialShareError(failure[0], failure[1], failure[2])

    if row is not None:
        db.delete(row)                                    # delivered to the mail server: the temporary copy is gone
    _audit(db, actor_id, org_id, user, "SENT")
    db.commit()
    return {"code": "SENT", "message": f"Login credentials were sent to {user.email}. The mail server accepted the message; delivery to the inbox is not confirmed."}
