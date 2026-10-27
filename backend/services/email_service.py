"""
The one place PrepWin talks SMTP. Used only for assessment invitations (routers/job_assessments.py) and the administrator-triggered
"Share credentials" e-mail (services/credential_delivery.py); self-service password reset and other mail flows stay absent on purpose.

Configuration comes from the environment only (never hard-coded, never returned by an API, never logged):

    SMTP_HOST      required        mail server host name
    SMTP_PORT      default 587     465 = implicit TLS, anything else = STARTTLS
    SMTP_USER      optional pair   login; if set, SMTP_PASSWORD must be set too
    SMTP_PASSWORD  optional pair
    SMTP_FROM      default SMTP_USER   sender, plain address or "Name <address>"
    SMTP_SECURITY  optional        auto (default) | starttls | ssl | none   ("none" is for a local test relay only)

Results are typed so callers can tell what to do next:
    EmailNotConfigured   settings missing/invalid        -> nothing can be sent, tell the admin
    EmailSystemError     connect / TLS / auth failure    -> every recipient would fail the same way, stop the batch
    EmailRecipientError  this recipient was refused      -> permanent, other recipients are unaffected
    (transient trouble is retried a bounded number of times, then surfaces as EmailRecipientError(transient=True))

`send()` returning means the SMTP server ACCEPTED the message. That is not proof the message reached an inbox.
"""
import logging
import os
import smtplib
import socket
import ssl
import time
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import formataddr, parseaddr
from typing import Optional

logger = logging.getLogger("prepwin.email")

MAX_ATTEMPTS = 3            # per message: first try + 2 retries, transient failures only
RETRY_BACKOFF_SECONDS = (1.0, 3.0)
CONNECT_TIMEOUT_SECONDS = 15


class EmailError(Exception):
    """Base class. `str(exc)` is always a short, credential-free sentence that is safe to store and show."""


class EmailNotConfigured(EmailError):
    pass


class EmailSystemError(EmailError):
    pass


class EmailRecipientError(EmailError):
    def __init__(self, message: str, transient: bool = False):
        super().__init__(message)
        self.transient = transient


@dataclass(frozen=True)
class SmtpSettings:
    host: str
    port: int
    user: Optional[str]
    password: Optional[str]
    sender: str          # bare address, used as the envelope sender
    sender_header: str   # value of the From header
    security: str        # ssl | starttls | none


def _sleep(seconds: float) -> None:  # indirection so tests never wait
    time.sleep(seconds)


def load_settings(environ=None) -> SmtpSettings:
    env = os.environ if environ is None else environ
    host = (env.get("SMTP_HOST") or "").strip()
    if not host:
        raise EmailNotConfigured("Email is not configured on the server (SMTP_HOST is missing).")
    raw_port = (env.get("SMTP_PORT") or "587").strip()
    try:
        port = int(raw_port)
        if not 0 < port < 65536:
            raise ValueError
    except ValueError:
        raise EmailNotConfigured("Email is not configured correctly on the server (SMTP_PORT is invalid).")

    user = (env.get("SMTP_USER") or "").strip() or None
    password = env.get("SMTP_PASSWORD") or None
    if bool(user) != bool(password):
        raise EmailNotConfigured("Email is not configured correctly on the server (SMTP_USER and SMTP_PASSWORD must be set together).")

    from_raw = (env.get("SMTP_FROM") or user or "").strip()
    name, address = parseaddr(from_raw)
    if not address or "@" not in address or any(c in from_raw for c in "\r\n"):
        raise EmailNotConfigured("Email is not configured correctly on the server (SMTP_FROM is missing or invalid).")

    security = (env.get("SMTP_SECURITY") or "auto").strip().lower()
    if security not in ("auto", "ssl", "starttls", "none"):
        raise EmailNotConfigured("Email is not configured correctly on the server (SMTP_SECURITY is invalid).")
    if security == "auto":
        security = "ssl" if port == 465 else "starttls"

    return SmtpSettings(host=host, port=port, user=user, password=password, sender=address,
                        sender_header=formataddr((name, address)) if name else address, security=security)


def is_configured(environ=None) -> bool:
    try:
        load_settings(environ)
        return True
    except EmailNotConfigured:
        return False


def _one_line(value: str) -> str:
    return " ".join((value or "").split())


def build_message(settings: SmtpSettings, to_address: str, subject: str, html: str, text: str,
                  to_name: Optional[str] = None) -> EmailMessage:
    """Multipart message: plain text first, HTML alternative second. Header values can never carry a line break."""
    msg = EmailMessage()
    msg["Subject"] = _one_line(subject)[:200]
    msg["From"] = settings.sender_header
    msg["To"] = formataddr((_one_line(to_name or ""), _one_line(to_address))) if to_name else _one_line(to_address)
    msg.set_content(text)
    msg.add_alternative(html, subtype="html")
    return msg


def _connect(settings: SmtpSettings) -> smtplib.SMTP:
    """Opens an authenticated connection. Raises EmailSystemError (never leaks a raw server reply or the password)."""
    server = None
    try:
        context = ssl.create_default_context()
        if settings.security == "ssl":
            server = smtplib.SMTP_SSL(settings.host, settings.port, timeout=CONNECT_TIMEOUT_SECONDS, context=context)
        else:
            server = smtplib.SMTP(settings.host, settings.port, timeout=CONNECT_TIMEOUT_SECONDS)
            server.ehlo()
            if settings.security == "starttls":
                if not server.has_extn("starttls"):
                    # never send the password over an unencrypted connection
                    raise EmailSystemError("The mail server does not offer an encrypted (TLS) connection.")
                server.starttls(context=context)
                server.ehlo()
        if settings.user:
            server.login(settings.user, settings.password)
        return server
    except EmailSystemError:
        _quiet_close(server)
        raise
    except smtplib.SMTPAuthenticationError:
        _quiet_close(server)
        raise EmailSystemError("The mail server rejected the configured credentials.")
    except ssl.SSLError:
        _quiet_close(server)
        raise EmailSystemError("A secure (TLS) connection to the mail server could not be established.")
    except (smtplib.SMTPException, OSError):  # includes socket.timeout, refused / unreachable, DNS failure, disconnects
        _quiet_close(server)
        raise EmailSystemError("Could not connect to the mail server.")


def _quiet_close(server) -> None:
    if server is None:
        return
    try:
        server.quit()
    except Exception:
        try:
            server.close()
        except Exception:
            pass


def _send_once(settings: SmtpSettings, msg: EmailMessage, to_address: str) -> None:
    server = _connect(settings)
    try:
        refused = server.send_message(msg, from_addr=settings.sender, to_addrs=[to_address])
        if refused:  # send_message returns the refused recipients instead of raising when only some were refused
            raise EmailRecipientError("The mail server refused this recipient address.")
    except smtplib.SMTPRecipientsRefused:
        raise EmailRecipientError("The mail server refused this recipient address.")
    except smtplib.SMTPSenderRefused:
        raise EmailSystemError("The mail server refused the configured sender address.")
    except smtplib.SMTPResponseException as exc:
        # 4xx = the server asked us to try later; 5xx = permanent
        raise EmailRecipientError("The mail server rejected the message." if exc.smtp_code >= 500
                                  else "The mail server is temporarily unavailable.", transient=exc.smtp_code < 500)
    except (smtplib.SMTPServerDisconnected, smtplib.SMTPConnectError, socket.timeout, TimeoutError, ConnectionError):
        raise EmailRecipientError("The connection to the mail server was interrupted.", transient=True)
    except smtplib.SMTPException:
        raise EmailRecipientError("The mail server could not accept the message.", transient=True)
    finally:
        _quiet_close(server)


def send(settings: SmtpSettings, to_address: str, subject: str, html: str, text: str, to_name: Optional[str] = None) -> int:
    """
    Sends one message and returns how many attempts it took. Returning means the SMTP server accepted it, nothing more.
    Transient failures are retried (MAX_ATTEMPTS in total); a system error (connect / TLS / auth) is raised at once because
    retrying cannot help and every other recipient of the batch would fail identically.
    """
    msg = build_message(settings, to_address, subject, html, text, to_name)
    last: Optional[EmailRecipientError] = None
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            _send_once(settings, msg, to_address)
            return attempt
        except EmailRecipientError as exc:
            last = exc
            if not exc.transient or attempt == MAX_ATTEMPTS:
                break
            logger.warning("SMTP transient failure (attempt %d/%d): %s", attempt, MAX_ATTEMPTS, exc)
            _sleep(RETRY_BACKOFF_SECONDS[min(attempt - 1, len(RETRY_BACKOFF_SECONDS) - 1)])
        except EmailSystemError as exc:
            logger.error("SMTP system failure: %s", exc)  # exc text is credential-free by construction
            raise
    assert last is not None
    raise last
