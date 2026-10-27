# HIRINGAI PRODUCTION DEPLOYMENT GUIDE

This document provides step-by-step instructions for deploying the **HiringAI Enterprise B2B SaaS Platform** to a production environment.

---

## 1. Server Requirements
* **Minimum Specifications:**
  * CPU: 2 vCPUs (4 vCPUs recommended for concurrent proctoring inference & AI summarization)
  * RAM: 4 GB (8 GB recommended for YOLOv8 CPU inference + Gunicorn worker pool)
  * Disk: 40 GB NVMe / SSD (provisioned with growth capacity for resume storage and MySQL)
  * Network: Outbound internet access for Groq, Gemini, ElevenLabs, Judge0, and Let's Encrypt

---

## 2. Operating System Requirements
* **Supported OS:**
  * Ubuntu 22.04 LTS or 24.04 LTS (recommended)
  * Debian 12
  * Rocky Linux 9 / RHEL 9

---

## 3. Python Version
* **Python Runtime:** Python `3.10.x` or `3.11.x` (Python 3.11 is used in Docker container)
* **Required System Libraries for OpenCV & Vision:**
  ```bash
  sudo apt-get update && sudo apt-get install -y \
      python3-pip python3-venv build-essential \
      libgl1 libglib2.0-0 curl
  ```

---

## 4. Node Version
* **Node.js Runtime:** Node `v20.x LTS` (Node 20+ required for Vite 5 production builds)
* **Package Manager:** `npm` v10+

---

## 5. Docker Requirements (Containerized Deployment)
* Docker Engine: `24.0.0+`
* Docker Compose: `v2.20.0+`
* Installation:
  ```bash
  curl -fsSL https://get.docker.com -o get-docker.sh
  sudo sh get-docker.sh
  sudo usermod -aG docker $USER
  ```

---

## 6. MySQL Requirements
* **Engine:** MySQL Server `8.0+`
* **Default Port:** `3306` (isolated; never expose directly to the public internet)
* **Character Set & Collation:** `utf8mb4` / `utf8mb4_unicode_ci`
* **Connection Pooling:** Configured in `database.py` with `pool_size=10`, `max_overflow=20`, `pool_recycle=3600`, and `pool_pre_ping=True`.

---

## 7. Redis Requirements
* **Engine:** Redis `7.0+`
* **Default Port:** `6379` (internal network only)
* **Configuration:** Append-only file (`appendonly yes`) enabled for persistence.

---

## 8. Required Environment Variables

### Backend (`backend/.env`)
| Variable | Required | Description |
|---|---|---|
| `DEBUG` | Yes | Must be set to `False` in production |
| `FRONTEND_URL` | Yes | Production URL (e.g. `https://app.yourdomain.com`) |
| `CORS_ORIGINS` | Yes | Comma-separated allowed origins (e.g. `https://app.yourdomain.com`) |
| `DATABASE_URL` | Yes | `mysql+pymysql://<user>:<pass>@<host>:3306/<dbname>` |
| `JWT_SECRET_KEY` | Yes | Cryptographically secure random secret (min 32 bytes) |
| `SESSION_TTL_HOURS` | Optional | Absolute login lifetime in hours (default 12) |
| `SESSION_IDLE_MINUTES` | Optional | Idle timeout in minutes (default 120) |
| `SESSION_COOKIE_SECURE` / `SESSION_COOKIE_SAMESITE` | Optional | Cookie overrides. `Secure` is on by default in production; serve the app over HTTPS |
| `ADMIN_INITIAL_PASSWORD` | Optional | First run only. Without it a new platform admin is created locked: run `python scripts/set_admin_password.py` |
| `PLATFORM_ADMIN_EMAIL` | Yes | Explicit owner email (`admin@thirdeyedata.ai`) |
| `GROQ_API_KEY` | Yes | Primary Groq API key |
| `GROQ_API_KEY_FALLBACK_1` | Optional | Fallback Groq API key 1 |
| `GROQ_API_KEY_FALLBACK_2` | Optional | Fallback Groq API key 2 |
| `GEMINI_API_KEY` | Optional | Google Gemini API key for fallback inference |
| `ELEVENLABS_API_KEY` | Yes | ElevenLabs API key (speech-to-text and text-to-speech for the voice interview; never sent to the browser) |
| `ELEVENLABS_VOICE_ID` | Yes | ElevenLabs voice the AI interviewer speaks with |
| `JUDGE0_API_URL` | Yes | Code execution endpoint |
| `REDIS_URL` | Optional | `redis://<host>:6379/0` |

### Frontend (`frontend/.env.production`)
| Variable | Required | Description |
|---|---|---|
| `VITE_API_URL` | Yes | Backend API root (e.g. `https://app.yourdomain.com/api` or `https://api.yourdomain.com`) |

---

## 9. Authentication Setup (local accounts)

PrepWin authenticates users itself (email + password); there is no external identity provider.

1. **First administrator:** the platform admin (`PLATFORM_ADMIN_EMAIL`) must have a password before the first login. Run
   `python scripts/set_admin_password.py` on the server (it prompts without echo; the password is hashed, never printed or logged).
2. **Accounts:** only an authenticated administrator can create Student and Admin accounts (Admin Dashboard -> User Management).
   There is no public sign-up and no unauthenticated account-creation endpoint.
3. **Transport:** serve everything over HTTPS. The session cookie is `HttpOnly`, `SameSite=Lax` and `Secure` in production.
   If the API is on a different registrable domain than the SPA, set `SESSION_COOKIE_SAMESITE=none` and list the SPA origin in `CORS_ORIGINS`.
4. **Database migration:** `python migrate_local_auth.py --neutralize-placeholders` (backs up SQLite first) adds the profile columns and the
   `auth_sessions` table and clears the old Clerk-era placeholder password hashes. The API also adds the nullable columns on startup.
5. **Rate limiting:** failed logins are limited per account+client, per client and per account (in process memory; with several workers
   keep an nginx `limit_req` zone on `/api/auth/login/`).
6. **Multi-tenant rules** are unchanged: access is granted by `organization_members` records or the platform admin role. Unknown users cannot sign in.

---

## 10. Domain & DNS Configuration
* Create the following A/CNAME records in your DNS provider:
  * `app.yourdomain.com` $\rightarrow$ Server Public IPv4
  * (Optional) `api.yourdomain.com` $\rightarrow$ Server Public IPv4

---

## 11. HTTPS / SSL Setup (Let's Encrypt Certbot)
```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot certonly --standalone -d app.yourdomain.com
```
* Certificates will be located in `/etc/letsencrypt/live/app.yourdomain.com/`.

---

## 12. Nginx Reverse Proxy Setup
Copy `nginx/nginx.conf` to `/etc/nginx/sites-available/hiringai` or mount via Docker Compose:
```bash
sudo ln -s /etc/nginx/sites-available/hiringai /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```
* **Key configurations included:**
  * Strict TLS 1.2 / 1.3
  * Security headers (`X-Frame-Options`, `X-Content-Type-Options`, `HSTS`)
  * Proxy buffering & timeouts configured to 300s for AI streaming
  * Client body size set to `25M` for candidate resumes and proctoring snapshots

---

## 13. Database Migration Procedure

1. **Verify Database Connection:**
   ```bash
   cd backend
   python -c "import database; database.engine.connect(); print('Connected successfully!')"
   ```
2. **Execute Multi-Tenant Migrations:**
   ```bash
   python migrate_multitenant_schema.py
   python migrate_v2_schema.py
   ```
3. **Verify Tables:**
   ```bash
   mysql -u <DB_USER> -p<DB_PASSWORD> -h <DB_HOST> <DB_NAME> -e "SHOW TABLES;"
   ```
   * Ensure `organizations`, `organization_members`, `users`, `candidates`, `jobs`, `assessments`, `activity_logs` exist.

---

## 14. Database Backup & Restore Procedure

### Daily Automated Backup (Cron)
```bash
# Create backup directory
mkdir -p /var/backups/hiringai_mysql

# Run mysqldump
mysqldump -u <DB_USER> -p<DB_PASSWORD> -h <DB_HOST> \
    --single-transaction --quick --routines --triggers \
    hiringai | gzip > /var/backups/hiringai_mysql/backup_$(date +%Y%m%d_%H%M%S).sql.gz
```

### Restore Procedure
```bash
gunzip < /var/backups/hiringai_mysql/backup_YYYYMMDD_HHMMSS.sql.gz | \
    mysql -u <DB_USER> -p<DB_PASSWORD> -h <DB_HOST> hiringai
```

---

## 15. Application Startup

> **Which compose file?** There are two. `docker-compose.yml` (project `hiringai`, containers `hiringai_*`, host port 80) is the stack currently serving the live site. `docker-compose.prod.yml` (containers `interviewer_*`, host port 8212, own volumes/network) is the separate `interviewer.thirdeyedata.ai` / server2 stack. The `docker compose -f docker-compose.prod.yml` commands below apply only to that stack. On the live `hiringai` host use `docker compose up -d --build` (default file) and never run `docker-compose.prod.yml` against it.

### Option A: Using Docker Compose (Recommended)
```bash
# 1. Populate production secrets in backend/.env and frontend/.env.production
# 2. Build and start containers
docker compose -f docker-compose.prod.yml up -d --build

# 3. Check container status
docker compose -f docker-compose.prod.yml ps
```

### Option B: Bare Metal / Systemd Service

**Backend Service (`/etc/systemd/system/hiringai-backend.service`):**
```ini
[Unit]
Description=HiringAI FastAPI Backend
After=network.target mysql.service

[Service]
User=www-data
WorkingDirectory=/var/www/hiringai/backend
EnvironmentFile=/var/www/hiringai/backend/.env
ExecStart=/var/www/hiringai/backend/venv/bin/gunicorn -w 4 -k uvicorn.workers.UvicornWorker main:app --bind 127.0.0.1:8000
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

**Frontend Static Assets:**
```bash
cd frontend
npm ci
npm run build
sudo cp -r dist/* /var/www/hiringai/frontend/
```

---

## 16. Health Checks

* **Liveness Probe:**
  ```bash
  curl -i http://localhost:8000/health/live
  # Response: HTTP 200 {"status": "alive", "service": "HiringAI API"}
  ```
* **Readiness Probe:**
  ```bash
  curl -i http://localhost:8000/health/ready
  # Response: HTTP 200 {"status": "ready", "database": "connected"}
  ```

---

## 17. Log Locations & Monitoring
* **Backend Logs:** `journalctl -u hiringai-backend.service -f` (or `docker logs -f hiringai_backend_prod`)
* **Nginx Access Log:** `/var/log/nginx/access.log`
* **Nginx Error Log:** `/var/log/nginx/error.log`
* **Log Sanitization:** Sensitive authorization tokens, request passwords, and candidate PII are stripped from logs by design.

---

## 18. Restart & Zero-Downtime Reload
```bash
# Docker Compose reload
docker compose -f docker-compose.prod.yml restart backend

# Systemd graceful reload
sudo systemctl reload hiringai-backend.service
```

---

## 19. Rollback Procedure
1. If a newly deployed commit fails readiness probes:
   ```bash
   git checkout <PREVIOUS_STABLE_TAG_OR_COMMIT>
   docker compose -f docker-compose.prod.yml up -d --build backend frontend
   ```
2. If schema rollback is required:
   * Restore the pre-migration database snapshot using the Restore Procedure in Section 14.

---

## 20. Secret Management
* **Never store production secrets in git.**
* Keep master copies of production `.env` files in a dedicated secrets manager (AWS Secrets Manager, HashiCorp Vault, or 1Password Connect).
* Restrict server `.env` permissions:
  ```bash
  chmod 600 backend/.env
  chown www-data:www-data backend/.env
  ```

---

## 21. Monitoring & Alerts
* Uptime monitoring configured on `https://app.yourdomain.com/health/ready`.
* Alert notifications on:
  * HTTP status >= 500 for > 2 minutes
  * CPU utilization > 85% for > 5 minutes
  * Disk usage > 80%

---

## 22. Rebuild Safely

1. **Back up first.** Copy `backend/PrepWin.db` out of the running backend container (if the app uses SQLite) and run a `mysqldump` (Section 14) plus a copy of the `backend_media` volume. Backend images bake in `backend/PrepWin.db`; a rebuilt container without a persistent volume starts from that baked copy, so unsaved data is lost.
2. **Use the right compose file** for the host (see Section 15). Never run `docker-compose.prod.yml` against the live `hiringai` stack.
3. `docker compose up -d --build` rebuilds changed images and **recreates** the affected containers (brief downtime; container filesystems not backed by a volume are reset).
4. Rebuild only what changed, e.g. `docker compose up -d --build frontend`, to avoid touching the backend.
5. Verify with `curl -f http://localhost/health/live` afterwards.
