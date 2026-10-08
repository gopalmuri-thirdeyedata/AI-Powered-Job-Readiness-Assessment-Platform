# HIRINGAI PRODUCTION DEPLOYMENT GUIDE

This document provides step-by-step instructions for deploying the **HiringAI Enterprise B2B SaaS Platform** to a production environment.

---

## 1. Server Requirements
* **Minimum Specifications:**
  * CPU: 2 vCPUs (4 vCPUs recommended for concurrent proctoring inference & AI summarization)
  * RAM: 4 GB (8 GB recommended for YOLOv8 CPU inference + Gunicorn worker pool)
  * Disk: 40 GB NVMe / SSD (provisioned with growth capacity for resume storage and MySQL)
  * Network: Outbound internet access for Groq, Gemini, Vapi, Clerk, Judge0, and Let's Encrypt

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
| `CLERK_SECRET_KEY` | Yes | Production secret key (`sk_live_...`) |
| `CLERK_PUBLISHABLE_KEY`| Yes | Production publishable key (`pk_live_...`) |
| `PLATFORM_ADMIN_CLERK_USER_ID` | Yes | Clerk user ID of `gopalmuri1919@gmail.com` |
| `PLATFORM_ADMIN_EMAIL` | Yes | Explicit owner email (`gopalmuri1919@gmail.com`) |
| `GROQ_API_KEY` | Yes | Primary Groq API key |
| `GROQ_API_KEY_FALLBACK_1` | Optional | Fallback Groq API key 1 |
| `GROQ_API_KEY_FALLBACK_2` | Optional | Fallback Groq API key 2 |
| `GEMINI_API_KEY` | Optional | Google Gemini API key for fallback inference |
| `VAPI_PRIVATE_KEY` | Yes | Vapi private API key for interview evaluation |
| `VAPI_PUBLIC_KEY` | Yes | Vapi public key |
| `PISTON_API_URL` | Yes | Code execution endpoint |
| `EMAIL_HOST_USER` | Yes | SMTP sender email |
| `EMAIL_HOST_PASSWORD` | Yes | SMTP app password |
| `REDIS_URL` | Optional | `redis://<host>:6379/0` |

### Frontend (`frontend/.env.production`)
| Variable | Required | Description |
|---|---|---|
| `VITE_API_URL` | Yes | Backend API root (e.g. `https://app.yourdomain.com/api` or `https://api.yourdomain.com`) |
| `VITE_CLERK_PUBLISHABLE_KEY` | Yes | Production Clerk key (`pk_live_...`) |
| `VITE_VAPI_PUBLIC_KEY` | Yes | Vapi Public API Key |

---

## 9. Clerk Production Setup

1. **Create Production Instance:**
   * In the Clerk Dashboard, switch from **Development** to **Production**.
2. **Configure Allowed Origins & Redirects:**
   * Allowed Origins: `https://app.yourdomain.com`
   * Home URL: `https://app.yourdomain.com`
   * Sign-in Redirect: `https://app.yourdomain.com/dashboard`
   * Sign-up Redirect: `https://app.yourdomain.com/dashboard`
3. **Authentication Methods:**
   * Enable Google OAuth and GitHub OAuth.
   * Enable Email + Password with Email verification code (OTP).
4. **B2B Architecture Rules:**
   * Disable "Allow users to create organizations" in Clerk dashboard if using platform-admin-provisioned companies.
   * The system strictly grants access based on `organization_members` database records or `PLATFORM_ADMIN` role (`gopalmuri1919@gmail.com`). Unknown users receive HTTP 403.

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
