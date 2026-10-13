from passlib.context import CryptContext
from datetime import datetime, timedelta
from typing import Optional
from jose import jwt
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import os
import re
from dotenv import load_dotenv

load_dotenv()

# Security Config
INSECURE_DEFAULT_JWT_SECRETS = {
    "your-secret-key-here",
    "secret",
    "changeme",
    "admin",
    "default",
    "password",
    ""
}

def is_production() -> bool:
    """Detects whether application is configured to run in production mode."""
    env = os.getenv("ENVIRONMENT", "").strip().lower()
    debug = os.getenv("DEBUG", "").strip().lower()
    return env in ("production", "prod") or (debug in ("false", "0", "no") and env not in ("development", "test"))

def validate_jwt_secret() -> str:
    """
    Validates JWT signing secret.
    In production mode, raises a RuntimeError if the secret is missing, uses a default placeholder,
    or has fewer than 32 characters.
    In development/testing mode, falls back to the local development placeholder.
    """
    secret = (os.getenv("JWT_SECRET_KEY") or os.getenv("DJANGO_SECRET_KEY") or os.getenv("SECRET_KEY") or "").strip()
    if is_production():
        if not secret or secret in INSECURE_DEFAULT_JWT_SECRETS:
            raise RuntimeError(
                "FATAL: JWT signing secret is unconfigured or using a default placeholder in production. "
                "A strong JWT_SECRET_KEY (minimum 32 characters) must be explicitly configured."
            )
        if len(secret) < 32:
            raise RuntimeError(
                f"FATAL: Production JWT_SECRET_KEY must be at least 32 characters long (current length: {len(secret)})."
            )
        return secret

    # Development / testing fallback
    return secret or "your-secret-key-here"

def get_secret_key() -> str:
    """Dynamically resolves and validates the active JWT signing key."""
    return validate_jwt_secret()

SECRET_KEY = validate_jwt_secret()
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 10080  # 7 days — sufficient for full candidate test lifecycle

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        # Use configured expiry (not hardcoded 15 min)
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    secret = get_secret_key()
    encoded_jwt = jwt.encode(to_encode, secret, algorithm=ALGORITHM)
    return encoded_jwt

def create_resume_preview_token(email: str, file_path: str, expires_seconds: int = 60) -> str:
    """
    Generates a short-lived, narrowly scoped token specifically for browser iframe/window navigation.
    Scoped strictly to 'resume_preview' and binds to the specific file path.
    """
    expire = datetime.utcnow() + timedelta(seconds=expires_seconds)
    payload = {
        "sub": email,
        "scope": "resume_preview",
        "file_path": file_path,
        "exp": expire
    }
    secret = get_secret_key()
    return jwt.encode(payload, secret, algorithm=ALGORITHM)

# Email Config
EMAIL_HOST = os.getenv("EMAIL_HOST", "smtp.gmail.com")
EMAIL_PORT = int(os.getenv("EMAIL_PORT", 587))
EMAIL_USER = os.getenv("EMAIL_HOST_USER")
EMAIL_PASSWORD = os.getenv("EMAIL_HOST_PASSWORD")

def is_valid_candidate_email(email: Optional[str]) -> bool:
    """
    Validates whether an email is a legitimate, non-dummy candidate email.
    Rejects dummy placeholders like xxxx@gmail.com, test@example.com, etc.
    """
    if not email or not isinstance(email, str):
        return False
        
    cleaned = email.strip().lower()
    
    # 1. Standard RFC email format check
    email_regex = r'^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$'
    if not re.match(email_regex, cleaned):
        return False
        
    parts = cleaned.split('@')
    if len(parts) != 2:
        return False
        
    local, domain = parts[0], parts[1]
    
    # 2. Check domain validity
    if len(domain) < 3 or '.' not in domain:
        return False
    tld = domain.split('.')[-1]
    if len(tld) < 2 or not tld.isalpha():
        return False
        
    # Reject known dummy/placeholder domains
    dummy_domains = {
        'example.com', 'example.org', 'example.net',
        'test.com', 'sample.com', 'domain.com', 'email.com',
        'mail.com', 'yoursite.com', 'site.com', 'company.com',
        'mywebsite.com', 'xyz.com', 'abc.com', 'temp.com',
        'placeholder.com', 'fakemail.com', 'none.com', 'null.com'
    }
    if domain in dummy_domains or any(d in domain for d in ['example.', 'sample.', 'placeholder.', 'fakemail.']):
        return False
        
    # 3. Check dummy/placeholder local part (before @)
    # Rejects: x, xx, xxx, xxxx, xxxxx, etc.
    if re.match(r'^x+$', local):
        return False
    # Rejects: yyy, zzz, 000, 111, aaa, etc. (all same char, length >= 2)
    clean_local_alpha = re.sub(r'[^a-z0-9]', '', local)
    if len(clean_local_alpha) >= 2 and len(set(clean_local_alpha)) == 1:
        return False
        
    # Rejects local containing 3+ consecutive x's (e.g. name_xxxx@gmail.com, xxxx.123@gmail.com)
    if re.search(r'x{3,}', local):
        return False
        
    # Rejects single character local parts (e.g. a@gmail.com)
    if len(local) <= 1:
        return False
        
    # Known dummy username keywords
    dummy_keywords = {
        'test', 'dummy', 'sample', 'example', 'demo', 'placeholder',
        'fake', 'none', 'null', 'na', 'n/a', 'temp', 'xyz', 'abc',
        'user', 'username', 'name', 'yourname', 'youremail', 'your_email',
        'your.name', 'candidate', 'myemail', 'email', 'mail',
        'first.last', 'firstname.lastname', 'john.doe', 'johndoe',
        'jane.doe', 'janedoe', 'unknown', 'invalid', 'noemail',
        'noreply', 'no-reply', 'admin', 'contact', 'info', 'support',
        'sales', 'jobs', 'careers', 'hr', 'enquiry', 'help', 'service'
    }
    if local in dummy_keywords:
        return False
        
    return True

def send_email(to_email: str, subject: str, html_content: str):
    # Skip dummy or internal placeholder emails
    if not to_email or not is_valid_candidate_email(to_email) or to_email.endswith(".internal"):
        print(f"Skipping email delivery to unverified/dummy address: {to_email}")
        return False

    # Fetch latest credentials from environment
    load_dotenv(override=True)
    host = os.getenv("EMAIL_HOST", "smtp.gmail.com")
    port = int(os.getenv("EMAIL_PORT", 587))
    user = os.getenv("EMAIL_HOST_USER")
    password = os.getenv("EMAIL_HOST_PASSWORD")

    if not user or not password:
        print("Email credentials not set. Skipping email.")
        return False

    try:
        msg = MIMEMultipart()
        msg['From'] = user
        msg['To'] = to_email
        msg['Subject'] = subject

        msg.attach(MIMEText(html_content, 'html'))

        server = smtplib.SMTP(host, port)
        server.starttls()
        server.login(user, password)
        text = msg.as_string()
        server.sendmail(user, to_email, text)
        server.quit()
        print(f"Email sent to {to_email}")
        return True
    except Exception as e:
        print(f"Failed to send email: {e}")
        return False
