# AI-Powered Job Readiness Assessment Platform (interviewer.learningpath.ai) - Operational Runbook

Deployment runbook for **AI-Powered Job Readiness Assessment Platform** (branch `PrepWin`) on `server2` (`139.99.62.133`), served at **`https://interviewer.learningpath.ai`** with host entrypoint port **`8212`**.

Last updated: 2026-10-28 (server2 runs commit `b1a72383` plus the build-speed changes in 5.8; the database dates from the 2026-10-27 fresh start and was migrated in place on 2026-10-28). Sections 1-4 describe how to deploy and operate the stack. Section 5 covers build time and image size, and 5.8 records what was done and measured.

**2026-10-28 summary:** builds now go through `bash scripts/build-images.sh` (2.5, 5.8). The backend's dependencies live in a tagged base image, so a code-only deploy takes seconds even when the build cache was pruned. The build changes were deployed to server2 on 2026-10-28 and verified (end of 5.8). A plan for a 20-student concurrent trial (rate limits, thread settings, sandbox waiting, rehearsal) is in `plan.md`.

**2026-10-27 summary:** Clerk was removed. Login is now email + password with an HttpOnly session cookie and a three-role model (SUPER_ADMIN / ADMIN / STUDENT). Day-to-day redeploys are in 2.5, a wipe-and-restart on an empty MySQL is in 2.6, and an in-place schema upgrade (not run on server2, read from the code) is in 2.7. New failure modes found during that deploy are 3.1 (deadlock on an empty DB), 3.7 (stale proxy config), 3.8 (slow MySQL first start) and 3.9 (admin password script rejects SUPER_ADMIN).

---

## 1. System Architecture & Port Allocation

| Component | Host Port | Container Port | Container Name | Image / Service | Description |
| :--- | :---: | :---: | :--- | :--- | :--- |
| **Edge Proxy** | **8212** | 80 | `interviewer_proxy` | `nginx:alpine` | Internal routing proxy (`/api/` -> backend, `/` -> frontend) |
| **Backend** | - | 8000 | `interviewer_backend` | FastAPI (Python 3.11) | Gunicorn + Uvicorn workers, Gemini AI, resume parsing, YOLO proctoring, local session auth |
| **Frontend** | - | 80 | `interviewer_frontend` | React + Vite (Node 20 build, nginx serve) | Assessment SPA with local session login and ElevenLabs voice |
| **Database** | - | 3306 | `interviewer_mysql` | `mysql:8.0` | MySQL (not published on the host) |
| **Cache** | - | 6379 | `interviewer_redis` | `redis:7-alpine` | In-memory cache and sessions |
| **Network** | - | - | `interviewer_net` | Subnet `10.97.0.0/24` | Isolated Docker network |

- **Public domain**: https://interviewer.learningpath.ai (behind Cloudflare, see 2.4)
- **Direct internal port**: `http://127.0.0.1:8212`
- **Host nginx config**: `/etc/nginx/sites-available/interviewer.learningpath.ai`
- **SSL certificate**: `/etc/letsencrypt/live/interviewer.learningpath.ai/fullchain.pem`
- **Remote project directory**: `/home/aniket-TED/interviewer-platform`
- **Compose file**: `docker-compose.prod.yml`

---

## 2. Step-by-Step Deployment Procedure

### 2.1 Take down the old HiringAI container and port 8092 config (server2)

```bash
cd /home/hiringai-v1 && docker compose down
sudo rm -f /etc/nginx/sites-enabled/hiringai-v1
sudo nginx -t && sudo systemctl reload nginx
```

### 2.2 Package and upload from the local machine (PowerShell)

```powershell
cd "D:\Downloads\PJS Global Demo 4\AI-Powered-Job-Readiness-Assessment-Platform"

tar -czvf interviewer_platform.tar.gz `
    --exclude=*.tar.gz `
    --exclude=node_modules `
    --exclude=__pycache__ `
    --exclude=*/__pycache__ `
    --exclude=.git `
    --exclude=backend/.env `
    --exclude=*.db `
    --exclude=backend/backups `
    .

scp interviewer_platform.tar.gz server2:~/interviewer_platform.tar.gz
```

`backend/.env` is excluded on purpose. The server keeps its own copy (production values), and extracting the archive does not delete files it doesn't contain, so the server's `.env` survives. Local `*.db` files and `backend/backups` are excluded so dev data never reaches the server. The archive still contains `docker-compose.prod.yml`, which overwrites the server's copy, so the repo's compose must carry the production domain (check with the `grep` in 2.5). Delete the archive from the server after extracting.

### 2.3 Build and launch (server2)

```bash
mkdir -p ~/interviewer-platform
tar -xzvf ~/interviewer_platform.tar.gz -C ~/interviewer-platform
rm -f ~/interviewer_platform.tar.gz
cd ~/interviewer-platform

docker compose -f docker-compose.prod.yml up -d --build

docker compose -f docker-compose.prod.yml ps
curl -s http://127.0.0.1:8212/health/live
```

A cold build is slow, mainly the backend `pip install` (PyTorch via ultralytics) and the frontend `npm ci`. See section 5.

This plain `up -d --build` is only safe when the MySQL database already has its tables. On an empty database the four gunicorn workers race to create the schema and crash (see 3.1). Use 2.6 for a first start, and 2.5 for routine updates.

### 2.4 Host nginx, DNS and SSL (server2)

The domain is on Cloudflare. In the Cloudflare DNS panel, the `interviewer` A record must point to `139.99.62.133`.

```bash
sudo tee /etc/nginx/sites-available/interviewer.learningpath.ai > /dev/null << 'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name interviewer.learningpath.ai;
    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:8212;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/interviewer.learningpath.ai /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

sudo certbot --nginx -d interviewer.learningpath.ai --non-interactive --agree-tos \
    -m aniket@thirdeyedata.ai --redirect

curl -I https://interviewer.learningpath.ai
curl -s https://interviewer.learningpath.ai/health/live
```

**Cloudflare notes (hit during the first deploy):**

- Cloudflare's "Always Use HTTPS" answers HTTP requests with a 301 at the edge. This interferes with certbot's HTTP challenge. Set the DNS record to **DNS only** (grey cloud), run certbot, then switch it back to proxied (orange).
- Once proxied, set SSL/TLS mode to **Full (strict)**. **Flexible** causes a redirect loop because nginx redirects to HTTPS.

### 2.5 Routine redeploy (code changes, database already populated)

Local (PowerShell): build the archive exactly as in 2.2 and `scp` it. Then on server2:

```bash
cd ~/interviewer-platform
tar -xzvf ~/interviewer_platform.tar.gz -C ~/interviewer-platform
rm -f ~/interviewer_platform.tar.gz
grep -n "thirdeyedata" docker-compose.prod.yml      # must print nothing (the domain is interviewer.learningpath.ai)

bash scripts/build-images.sh backend frontend        # add code_runner when code-runner/ changed; see 5.8
docker compose -f docker-compose.prod.yml up -d --no-build --no-deps backend frontend

# ALWAYS recreate the proxy after an extract (see 3.7), or /api calls 404 against a stale nginx.conf
docker compose -f docker-compose.prod.yml up -d --force-recreate --no-deps reverse_proxy
docker exec interviewer_proxy nginx -t

# the recreated frontend loses the manual permission fix (see 3.3)
docker exec interviewer_frontend chmod 644 /usr/share/nginx/html/logo_main.png
```

Then run the checks in section 7. Build only what changed: a config-only change needs no build (5.7). If the commit adds or changes database columns, read 2.7 before starting the new backend, because `create_all` does not alter existing tables.

### 2.6 Fresh database: wipe MySQL and start clean (done 2026-10-27)

**This deletes every user, job role, assessment and result.** Resumes in the `interviewer_media` volume and Redis data are left alone. server2 hosts about 60 containers, so remove the one volume by its exact name and never use `docker volume prune`.

```bash
cd ~/interviewer-platform
# extract the new archive first (2.5, up to and including the grep)

docker compose -f docker-compose.prod.yml stop backend
docker compose -f docker-compose.prod.yml rm -sf db
docker volume ls --format '{{.Name}}' | grep interviewer        # read the names before deleting anything
docker volume rm interviewer-platform_interviewer_mysql_data    # exact name printed above

docker compose -f docker-compose.prod.yml build backend frontend
docker compose -f docker-compose.prod.yml up -d db redis
```

MySQL needs about 90 s to initialise an empty volume on server2. Wait until `docker logs interviewer_mysql --tail 8` shows `ready for connections ... port: 3306` (not `port: 0`, which is the temporary init server). See 3.8 if compose reports the container unhealthy.

Create the schema from ONE process before the workers start (3.1), then start the rest:

```bash
docker compose -f docker-compose.prod.yml run --rm --no-deps backend \
  python -c "import models, database; models.Base.metadata.create_all(bind=database.engine); print('tables ok')"

docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml up -d --force-recreate --no-deps reverse_proxy
docker exec interviewer_frontend chmod 644 /usr/share/nginx/html/logo_main.png
docker logs interviewer_backend --since 2m | grep -iE "traceback|Provisioned"
```

If a previous attempt already crashed halfway (partial tables and indexes), reset the still-empty database first. The app user's grants survive a `DROP DATABASE`:

```bash
docker exec interviewer_mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -e "DROP DATABASE $MYSQL_DATABASE; CREATE DATABASE $MYSQL_DATABASE;"'
```

**First admin.** The backend provisions the organization `ThirdEye Data` and the account `admin@thirdeyedata.ai` (role SUPER_ADMIN) on startup. The account is created **locked** unless `ADMIN_INITIAL_PASSWORD` is set in `backend/.env`. No default password exists in the source any more. `scripts/set_admin_password.py` rejects SUPER_ADMIN accounts (3.9), so set the password with this instead (prompts with no echo, same policy and hashing, signs out existing sessions):

```bash
docker compose -f docker-compose.prod.yml exec backend python -c "
import getpass, database, models, utils
from services import local_auth
from sqlalchemy.sql import func
email = 'admin@thirdeyedata.ai'
pw = getpass.getpass('New password: ')
if pw != getpass.getpass('Repeat: '):
    raise SystemExit('The two entries differ; nothing changed.')
errs = local_auth.password_policy_errors(pw, email)
if errs:
    raise SystemExit('Rejected: ' + ' | '.join(errs))
with database.SessionLocal() as db:
    u = db.query(models.User).filter(func.lower(models.User.email) == email).first()
    assert u and models.is_admin_role(u.role), 'admin account not found'
    u.hashed_password = utils.get_password_hash(pw)
    u.is_active = True
    n = local_auth.revoke_user_sessions(db, u.id)
    db.commit()
print('Password updated; sessions signed out:', n)
"
```

The password needs a lower-case letter, an upper-case letter and a digit, a minimum length, and no leading or trailing whitespace. To give the admin a display name (the column starts empty):

```bash
docker exec interviewer_mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot "$MYSQL_DATABASE" -e "UPDATE users SET full_name='"'"'Your Name Here'"'"' WHERE email='"'"'admin@thirdeyedata.ai'"'"'; SELECT id,email,role,full_name FROM users;"'
```

There is no sign-up. Admin and Student accounts are created by an administrator in the app (User Management). Existing Clerk-era accounts cannot sign in after the Clerk removal.

### 2.7 Upgrading an existing database in place (NOT run on server2; read from the code, test before relying on it)

Used when the data must be kept across the Clerk removal / recruitment-workflow release. The release changes the schema of tables that already exist, and `create_all` only creates missing tables.

- `migrate_recruitment_workflow.py` is **required** on MySQL. It adds columns to `job_descriptions` and `roleready_sessions`, moves the candidate email uniqueness to `(organization_id, email)`, and refuses to run without a verified backup (`mysqldump` plus a restore test). The backend image has no `mysql` / `mysqldump` client, so install it in a one-off container. The backup goes to the persistent media volume:

  ```bash
  docker exec interviewer_mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqldump -uroot --single-transaction --routines "$MYSQL_DATABASE"' > ~/hiringai_pre_upgrade_$(date +%F).sql
  tail -1 ~/hiringai_pre_upgrade_$(date +%F).sql            # must end with "-- Dump completed"

  docker compose -f docker-compose.prod.yml build backend frontend
  docker compose -f docker-compose.prod.yml stop backend
  docker compose -f docker-compose.prod.yml run --rm --no-deps -u root backend sh -c '
    apt-get update -qq && apt-get install -y -qq --no-install-recommends default-mysql-client >/dev/null &&
    python migrate_recruitment_workflow.py --backup-dir /app/media/backups &&
    python migrate_local_auth.py --neutralize-placeholders'
  ```

  Duplicate or blank candidate emails make it write `backend/migration_conflicts.json` and exit 1 without changing anything. The MariaDB client from Debian talking to MySQL 8 is untested here; if the backup step fails, the script aborts before touching the schema.
- `migrate_local_auth.py --neutralize-placeholders` replaces leftover Clerk placeholder password hashes with unusable ones. The API also applies the additive columns on every startup.
- `migrate_super_admin.py` handles **SQLite only**. On MySQL the backend promotes `admin@thirdeyedata.ai` to SUPER_ADMIN on startup, but any other legacy role value (`HR`, `RECRUITER`, `ORGANIZATION_ADMIN`, `PLATFORM_ADMIN`) must be fixed by hand. Check first: `SELECT role, COUNT(*) FROM users GROUP BY role;`
- `migrate_student_nullable_org.py` is SQLite-only too. Only needed on MySQL if inserts fail with "organization_id cannot be null", and then it must be done as manual `ALTER TABLE ... MODIFY organization_id INT NULL` statements.
- The old default admin password stays valid in an upgraded database. Replace it right away with the snippet in 2.6.

---

## 2A. Code Runner (in-house Python and Java execution)

Candidate code (the coding round, Python and Java only) runs in the `code_runner` service from `code-runner/` FIRST: there is no per-run
cost, and nothing leaves the host. **Judge0 is the fallback.** The runner answers the same `POST /submissions?wait=true` API the Judge0
adapter (`backend/services/judge0_service.py`) already uses, and the adapter tries it first when `CODE_RUNNER_URL` is set. Only a *service*
failure falls back to Judge0 (runner unreachable, busy, 5xx, invalid answer, internal error). A candidate's own compile error, runtime error,
time limit or wrong answer is a real result and is returned as it is, never re-run. If both are down the attempt is flagged
`EVALUATION_PENDING`, never scored. Each target has its own circuit breaker, so a dead runner does not block Judge0.

**How it is isolated**
- Its own container on the private `runner_net` network (`internal: true`): no internet and no route to the host. Only the backend is attached.
- Read-only root filesystem; `/tmp/runs` is a 256 MB tmpfs (`noexec,nosuid`). Memory 3 GB, 3 CPUs, 512 processes.
- `cap_drop: ALL`, then only `SETUID, SETGID, CHOWN, KILL, DAC_OVERRIDE` (each one was tested: without any of them the runner either fails
  every run or cannot stop a sleeping program). `no-new-privileges`, and `init: true` so the orphans of a fork bomb are reaped.
- Each run is a throwaway numeric uid (10001-10006, so at most 6 runs at once) in its own `0700` directory, with RLIMIT cpu / memory / file size /
  open files / processes, its own process group (killed on timeout) and output cut at 64 KB. When all six slots are busy for 5 s the runner
  answers HTTP 429 with `Retry-After: 1`; the backend adapter retries.
- **Not provided:** it is an ordinary hardened container shared by every run, with no per-run filesystem snapshot. Use it for invited
  candidates and keep it on the private network.

**Settings:** `docker-compose.prod.yml` sets the backend's `CODE_RUNNER_URL=http://code_runner:2358/submissions`, `CODE_EXECUTION_ENGINE=judge0`
and `SANDBOX_MAX_CONCURRENCY=2` (4 workers x 2 = 8; keep it at or below the 6 slots). The fallback target is `JUDGE0_API_URL` in
`backend/.env` (the public `ce.judge0.com` by default, or your own Judge0; add `JUDGE0_AUTH_TOKEN` there only if that Judge0 needs one). The
runner never receives the Judge0 token. The backend does not wait for the runner to be healthy to start, so a broken runner cannot take the
backend down.

**Check it**
```bash
docker compose -f docker-compose.prod.yml ps                  # interviewer_code_runner must be healthy
docker logs --tail 50 interviewer_code_runner
docker exec interviewer_backend python -c "import urllib.request; print(urllib.request.urlopen('http://code_runner:2358/health').read())"
```
Safe test run (on your own machine, never on server2): start the container with the same flags on an `--internal` network, then
`docker exec -i <container> python3 - http://127.0.0.1:2358 < code-runner/tests/smoke.py` (25 checks: limits, memory, fork bomb, output flood,
no network, no reading other runs, read-only filesystem, 20 parallel requests).

**Known limits:** Python and Java only (standard library, no pip or Maven). All of a question's test cases run in one program with one
overall time limit. A Java candidate must not write their own `import` lines: the generated wrapper already imports `java.util.*` and pastes
the candidate code after its own classes.

**Rollback** (no rebuild): remove `CODE_RUNNER_URL` from the backend's environment so only Judge0 is used (or set
`CODE_EXECUTION_ENGINE=gemini` for a demo), then `docker compose -f docker-compose.prod.yml up -d --no-build --no-deps backend`.

## 3. Known Issues Hit on First Deploy (and Fixes That Need No Rebuild)

All of these can be applied without rebuilding images.

### 3.1 Backend crash loop: `Table 'candidates' already exists` (error 1050)

**Cause:** `backend/main.py:173` runs `models.Base.metadata.create_all(...)` at import time. Gunicorn starts 4 workers at once, and they race to `CREATE TABLE`. One worker loses, the master halts, and Docker restarts the container in a loop.

**Fix, once, against the existing image (no build):**

```bash
cd ~/interviewer-platform
docker compose -f docker-compose.prod.yml stop backend

docker compose -f docker-compose.prod.yml run --rm --no-deps backend \
  python -c "import models, database; models.Base.metadata.create_all(bind=database.engine); print('tables ok')"

docker compose -f docker-compose.prod.yml up -d --no-build backend
docker logs interviewer_backend --since 2m
```

`docker compose run` has no `--no-build` flag. It reuses the image if it already exists locally.

Once the tables exist, `create_all` finds nothing to create and the race cannot happen on later restarts. This was the fix that stuck.

**Still happens on an EMPTY MySQL (2026-10-27).** `main.py` now has `create_tables_with_retry()`, but it only retries on "already exists", "schema has changed" and "database is locked". On a brand-new MySQL volume the four workers deadlock on `CREATE INDEX` instead (`pymysql OperationalError 1213 Deadlock found when trying to get lock`, for example on `ix_users_company_id`). That is not in the retry list, so a worker dies, gunicorn shuts down with `Worker failed to boot`, and Docker restarts the container in a loop. Crashed attempts can also leave tables with missing indexes, because `create_all` never adds an index to a table that already exists.

Fix, no code change: stop the backend, reset the empty database, create the schema once from a single process, then start (the exact commands are in 2.6). For a permanent fix, either add the deadlock error (1213, and lock wait timeout) to the retry list, or serialize startup with a MySQL `GET_LOCK` so only one worker runs `create_all`. Both need an image rebuild.

**Do NOT use `--preload` as the fix.** It was tried and caused 500 errors (`Command Out of Sync`, `_NoResultMetaData ... _indexes_for_keys`). With `--preload` the SQLAlchemy pool is created in the master and shared by all forked workers, so several processes use the same MySQL connection and the protocol gets corrupted. If a future fix needs `--preload`, `main.py` must call `database.engine.dispose()` right after `create_all`.

The live compose `command:` (under `backend:` in `docker-compose.prod.yml`) is now:

```yaml
    command: gunicorn --timeout 180 -w 4 -k uvicorn.workers.UvicornWorker -b 0.0.0.0:8000 main:app
```

Apply compose changes with `docker compose -f docker-compose.prod.yml up -d --no-build backend`.

### 3.2 Frontend shows `unhealthy` while the site works

**Cause:** the healthcheck is defined in `frontend/Dockerfile` (not in compose) and runs `wget http://localhost/`. In Alpine `localhost` resolves to IPv6 `::1`, but the container's nginx listens on IPv4 only.

**Fix without rebuild:** override it in compose under `frontend:`:

```yaml
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://127.0.0.1/"]
      interval: 30s
      timeout: 5s
      retries: 3
```

Then run `docker compose -f docker-compose.prod.yml up -d --no-build frontend`. The permanent fix is in the Dockerfile (section 5.3).

### 3.3 `logo_main.png` returned 403

**Cause:** the file had restrictive permissions inside the image, most likely because the archive was created on Windows. Live fix (lost if the container is recreated):

```bash
docker exec interviewer_frontend chmod 644 /usr/share/nginx/html/logo_main.png
```

The permanent fix is a `chmod -R a+rX` in the frontend Dockerfile (section 5.3).

### 3.4 Assessment setup fails with a Cloudflare "invalid or incomplete response" error (520/502)

**Symptom:** after "Start", the page shows "The origin web server returned an invalid or incomplete response to Cloudflare". Backend logs show `WORKER TIMEOUT` and `Worker ... was sent code 134`, and the proxy logs a 502 for `POST /api/api/roleready/student/initialize`.

**Cause:** `initialize_student_session` in `backend/routers/roleready.py` was declared `async def`, but it makes blocking calls (several sequential Gemini calls via `call_gemini`, each allowed 30 s plus a retry). A blocking call inside `async def` blocks the whole worker's event loop. Gunicorn cannot see the worker heartbeat for 30 s (its default timeout) and kills it. Other requests on that worker stall too.

**Fix:**

1. In source: change `async def initialize_student_session(` to `def initialize_student_session(`. The body has no `await`, and FastAPI then runs it in a thread pool. This is already done in the repo.
2. Raise gunicorn's timeout (`--timeout 180`, see 3.1).
3. Until the image is rebuilt, deploy the changed file with a bind mount, no rebuild. Upload it, make it readable, and add the mount under `backend:` > `volumes:` in `docker-compose.prod.yml`:

   ```powershell
   scp "D:\Downloads\PJS Global Demo 4\AI-Powered-Job-Readiness-Assessment-Platform\backend\routers\roleready.py" server2:~/interviewer-platform/backend/routers/roleready.py
   ```

   ```bash
   chmod 644 ~/interviewer-platform/backend/routers/roleready.py     # scp creates it owner-only; appuser (uid 1000) in the container must be able to read it
   ```

   ```yaml
       volumes:
         - interviewer_media:/app/media
         - ./backend/routers/roleready.py:/app/routers/roleready.py:ro
   ```

   ```bash
   docker compose -f docker-compose.prod.yml up -d --no-build backend
   docker exec interviewer_backend grep -n "def initialize_student_session" /app/routers/roleready.py   # must have no "async"
   ```

   Remove the mount line after the next rebuild, since the fix will then be in the image. (Done: the 2026-10-27 extract replaced the server's compose file with the repo's, which has no such mount.)

**Remaining limit:** Cloudflare cuts any proxied request at about 100 s (shown as a 524). If `initialize` can legitimately take longer, the endpoint should create a job and let the browser poll for the result. That is a code change.

To time one Gemini call from the container:

```bash
docker exec interviewer_backend python -c "
import time
from services.gemini_client import call_gemini
t=time.time(); print(call_gemini('Reply with the word OK')); print('seconds:', round(time.time()-t,1))"
```

### 3.5 Console warnings that are not bugs

- `/vite.svg` returns 404. This is a missing favicon and is harmless. Point the favicon in `frontend/index.html` at a file that exists.
- Clerk was removed on 2026-10-27, so its "development keys" warning no longer appears. See 6.3 for the current auth settings.

### 3.6 Requests for `/.env`, `/.env.local` and similar in the proxy logs

Automated scanners probe these paths. They return `200` because the SPA falls back to `index.html` for unknown paths. Confirm that no secrets are served:

```bash
curl -s https://interviewer.learningpath.ai/.env | head -5     # must print HTML, never KEY=value lines
```

### 3.7 Login shows "Not Found": the proxy kept its old nginx.conf (hit 2026-10-20)

**Symptom:** the sign-in modal shows `Not Found`. `POST /api/auth/login/` returns 404 while `POST /api/api/auth/login/` returns 401 (the backend handled it).

**Cause:** `interviewer_proxy` bind-mounts `./nginx/nginx.conf`. Extracting the archive replaces that file, but a running container keeps seeing the old file. The old config had `proxy_pass http://backend_api/;` (trailing slash), which strips `/api` before the backend. The current frontend calls `/api/...`, so the stripped path 404s.

**Diagnose:**

```bash
docker exec interviewer_proxy grep -n "proxy_pass" /etc/nginx/nginx.conf   # container's copy
grep -n "proxy_pass" nginx/nginx.conf                                      # file on disk, they should match
```

**Fix:** `docker compose -f docker-compose.prod.yml up -d --force-recreate --no-deps reverse_proxy`, then `docker exec interviewer_proxy nginx -t`. This is why 2.5 always recreates the proxy. The repo config also has a defensive `location /api/api/` block that forwards a doubled prefix to `/api/`.

### 3.8 `up -d` fails: "container interviewer_mysql is unhealthy" on a fresh volume (hit 2026-10-27)

Initialising an empty MySQL 8 volume took about 90 s on server2, longer than the compose healthcheck allows (30 s start period plus 5 tries 10 s apart). `docker compose up -d` then aborts with `dependency failed to start`, even though MySQL is fine. The healthcheck only runs `mysqladmin ping`, so it can also pass while the temporary init server is running. Wait for `ready for connections ... port: 3306` in `docker logs interviewer_mysql`, then run `up -d` again. Raising `start_period` for the `db` service in compose avoids the message.

### 3.9 `scripts/set_admin_password.py` says "No ADMIN account ... exists" (hit 2026-10-27)

The script requires `role == ADMIN` exactly, but the platform admin is `SUPER_ADMIN`, so it rejects the account and changes nothing. Use the inline snippet in 2.6. The fix in the script is to check `models.is_admin_role(user.role)` instead (needs a backend rebuild).

### 3.10 Startup log noise that is not a bug

- `Duplicate entry 'admin@thirdeyedata.ai' for key 'users.ix_users_email'` printed as `[Startup Note] Platform Admin initialization`: the four workers each try to provision the admin, one wins, the others hit the unique key. Harmless.
- Four `100%|... 6.25M/6.25M` progress bars: each worker downloads a ~6 MB model file at startup (almost certainly the YOLO proctoring weights via the ultralytics auto-download; inferred from the size, not confirmed). See the model-file note in 5.1.

---

## 3A. Changing the Domain (done 2026-10-14: thirdeyedata.ai -> learningpath.ai)

The site moved from `interviewer.thirdeyedata.ai` to **`interviewer.learningpath.ai`**. Do these in order. Deleting the old certificate while nginx still references it breaks `nginx -t`.

1. **DNS:** add an A record `interviewer` -> `139.99.62.133` in the learningpath.ai zone (grey cloud while certbot runs if the zone is on Cloudflare). Wait for `dig +short interviewer.learningpath.ai` to resolve.
2. **Replace the nginx site** with an HTTP-only one for the new name (section 2.4), and remove the old one:

   ```bash
   sudo rm -f /etc/nginx/sites-enabled/<old-site> /etc/nginx/sites-available/<old-site>
   sudo nginx -t && sudo systemctl reload nginx
   sudo grep -rl "<old-domain>" /etc/nginx/      # must print nothing
   ```

3. **Delete only the old certificate**, naming it explicitly. server2 holds about 50 certificates for other projects:

   ```bash
   sudo certbot certificates
   sudo certbot delete --cert-name <old-domain>
   ```

4. **Issue the new certificate:**

   ```bash
   sudo certbot --nginx -d interviewer.learningpath.ai --agree-tos --non-interactive \
     -m aniket@thirdeyedata.ai --redirect
   ```

5. **Update the backend's allowed origin** (no rebuild). `docker-compose.prod.yml` sets `FRONTEND_URL` and `CORS_ORIGINS`, and `backend/.env` has the same two keys. Compose's `environment:` overrides `env_file`, but keep both in agreement:

   ```bash
   cd ~/interviewer-platform
   sed -i 's#<old-domain>#interviewer.learningpath.ai#g' docker-compose.prod.yml backend/.env
   grep -rn "<old-domain>" docker-compose.prod.yml backend/.env      # must print nothing
   docker compose -f docker-compose.prod.yml up -d --no-build backend
   docker exec interviewer_backend printenv CORS_ORIGINS FRONTEND_URL
   ```

6. **Clerk:** no longer used (removed 2026-10-27), so there is nothing to change in a Clerk dashboard.
7. **Cloudflare:** if the record was set to DNS only, turn the proxy back on (orange) and set SSL/TLS mode to **Full (strict)**.

The frontend needs no rebuild for a domain change. It calls the API through the relative path `/api`.

---

## 4. Maintenance Commands

```bash
cd ~/interviewer-platform

docker compose -f docker-compose.prod.yml logs -f --tail=100
docker compose -f docker-compose.prod.yml restart
docker compose -f docker-compose.prod.yml ps

# Server resources
free -h; df -h /; docker system df
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}"
```

### Docker disk housekeeping on server2

server2 is shared by about 60 containers. Disk is 15% used (250G of 1.8T), so this is housekeeping, not urgent.

| Command | Safe? |
| :--- | :--- |
| `docker builder prune --filter until=168h` | Safe. Old build cache only, running containers unaffected. |
| `docker image prune` | Safe. Dangling images only. |
| `docker builder prune -a` | Safe for running containers, but the next build of every project is cold. |
| `docker system prune -a`, `docker volume prune` | **Do not run on this server.** They can remove images and database volumes that other projects need. |

On 2026-10-13 all build cache was wiped on server2 with `docker builder prune -a`. **The next build of the interviewer backend is therefore a cold build.**

---

## 5. Build Time and Image Size Improvements (for the team)

Measured on server2: `interviewer-platform-backend` is **10.5 GB**. The comparable `pjs-global-demo-backend` is 3.8 GB, and most other apps on the server are 0.1 to 2 GB. The frontend runtime image is only 98 MB, but `npm ci` is slow because of unused dependencies. Neither Dockerfile has a `.dockerignore`.

Work through the items in order. 5.1 and 5.2 give the biggest savings.

**Update 2026-10-28: most of this section is now done. See 5.8 for what changed and the measured results.** The older note below is kept for history.

**Status as of commit `c9d0817c` (read from the repo, not re-measured on the server):** the CPU-only torch install (5.1) and `--timeout 180` in the CMD (5.4) are in `backend/Dockerfile`, and `.dockerignore` files exist (5.5: `backend/.dockerignore`, and a root one for the unified image). Not re-checked: the npm removals (5.3), dropping `google-generativeai` (5.4), the root `Dockerfile` (5.6). Record the new image sizes here after the next rebuild.

### 5.1 Backend: install CPU-only PyTorch (biggest win)

`ultralytics==8.3.163` in `backend/requirements.txt` pulls in `torch` and `torchvision`. From PyPI on Linux these are the CUDA builds with the NVIDIA libraries, which is several GB. server2 runs the proctoring model on CPU (`proctor_service.py` documents it as "YOLOv8n (CPU-Optimized)"), so the GPU libraries are dead weight.

Install the CPU wheels first in `backend/Dockerfile`. `ultralytics` then sees torch as already satisfied and doesn't download the CUDA build:

```dockerfile
RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
```

**Verify:** build, then compare `docker images interviewer-platform-backend` against the 10.5 GB baseline, and hit the proctor status endpoint (see the model-file note below).

**Model file is not in the repo.** `proctor_service.py` loads `backend/models/yolov8n.pt`, but `.gitignore` excludes `*.pt` and `backend/models/` does not exist in the checkout. Check `GET /api/proctor/...` status on the live site. If it reports "model not initialized", proctoring is not working in this deployment today. Decide whether to ship the 6 MB `yolov8n.pt` (for example via a `COPY` in the Dockerfile) or accept that the feature is off. This also decides whether 5.2 option C is available.

### 5.2 Backend: decide whether proctoring needs ultralytics at all

| Option | Effect | Cost |
| :--- | :--- | :--- |
| A. Keep `ultralytics`, CPU torch (5.1) | Removes the CUDA payload. Image shrinks substantially. | None. This is the default recommendation. |
| B. Export YOLO to ONNX and run it with `onnxruntime` | Removes torch entirely (smallest image). | Code change in `services/proctor_service.py`, plus a re-test of detection accuracy. |
| C. Remove proctoring | Removes `ultralytics`, `opencv-python-headless`, `libgl1`, `libglib2.0-0`. | Loses a product feature. Only if the model file is confirmed absent and the feature is not used. |

Options B and C need a product decision. If you take B or C, `numpy` and `Pillow` become direct imports in `proctor_service.py` and must be added to `requirements.txt` (they currently arrive only through `ultralytics`).

### 5.3 Frontend: remove unused npm packages

No file in `frontend/src`, `index.html`, `vite.config.js` or `tailwind.config.js` imports any of these (searched for single- and double-quoted imports):

| Package | Why it is dead weight |
| :--- | :--- |
| `@tensorflow/tfjs` | Large (hundreds of MB in `node_modules`), 0 imports |
| `@tensorflow-models/blazeface` | 0 imports |
| `three` | 0 imports |
| `@react-three/fiber` | 0 imports. Also requires React 19, which is likely why `--legacy-peer-deps` is needed. |
| `@react-three/drei` | 0 imports |
| `gsap` | 0 imports |
| `socket.io-client` | 0 imports. The backend has no socket server either. |
| `react-toastify` | 0 imports |

Run locally in `frontend/`:

```bash
npm uninstall @tensorflow/tfjs @tensorflow-models/blazeface three @react-three/fiber @react-three/drei gsap socket.io-client react-toastify
npm run build            # must still succeed
```

**Commit the updated `package.json` and `package-lock.json` together.** `npm ci` fails if they disagree.

Then, in the same change, try removing `--legacy-peer-deps` from `frontend/Dockerfile`. If `npm ci` succeeds without it, leave it out. If it fails, keep the flag.

Still-used packages that look heavy (`@monaco-editor/react`, `jspdf`, `jspdf-autotable`, `xlsx`, `recharts`, `framer-motion`, `react-dropzone`) are all imported, so leave them. If bundle size matters later, lazy-load Monaco and the PDF/Excel libraries with `React.lazy` / dynamic `import()`. That is a runtime-performance change, not a build-time one.

**Permission and healthcheck fixes in `frontend/Dockerfile`** (fixes 3.2 and 3.3 permanently). After the `COPY --from=builder ...` line add:

```dockerfile
RUN chmod -R a+rX /usr/share/nginx/html
```

and change the healthcheck to:

```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -q --spider http://127.0.0.1/ || exit 1
```

### 5.4 Backend: smaller and safer Dockerfile and requirements

1. **Set a gunicorn timeout and fix the startup table race in code.** Do not add `--preload` unless `main.py` also calls `database.engine.dispose()` after `create_all` (see 3.1). Use:

   ```dockerfile
   CMD ["gunicorn", "--timeout", "180", "-w", "4", "-k", "uvicorn.workers.UvicornWorker", "main:app", "--bind", "0.0.0.0:8000"]
   ```

   To remove the table-creation race properly, guard `create_all` in `main.py` (for example, run it from a one-off startup command or a migration step) instead of running it on every worker import.

   Also find other `async def` endpoints that make blocking calls (Gemini, `requests`, database work with no `await`) and change them to `def`, as was done for `initialize_student_session` (3.4). Blocking calls in `async def` stall the whole worker.

2. **Drop `google-generativeai` if it is not needed.** `services/gemini_client.py` uses the SDK only "when installed" and falls back to native `httpx` REST otherwise. It drags in grpc, protobuf and the Google API client stack. Remove it from `requirements.txt`, then confirm Gemini features (resume screening, question generation, interview evaluation) still work through the `httpx` path.

3. **Remove the redundant pins** `urllib3==2.2.2` and `charset-normalizer==3.3.2`. Nothing imports them directly. `requests` installs them. This is a small cleanup and low priority.

4. **Keep these**, all verified as imported: `fastapi`, `uvicorn[standard]`, `sqlalchemy`, `pymysql`, `python-dotenv`, `python-multipart`, `python-jose`, `passlib`/`bcrypt`, `pydantic`, `email-validator` (used by `EmailStr`), `requests`, `httpx`, `pypdf`, `gunicorn`, `tenacity`.

5. **Pip cache mount.** The Dockerfile already copies `requirements.txt` before the source, which is the right order, so source edits don't reinstall dependencies. Add a BuildKit cache mount so a dependency change re-downloads nothing that was already fetched. Put `# syntax=docker/dockerfile:1.7` on the first line, remove `--no-cache-dir`, and use:

   ```dockerfile
   RUN --mount=type=cache,target=/root/.cache/pip pip install -r requirements.txt
   ```

   Do the same for the torch line in 5.1. For the frontend use `RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund`. Note that `docker builder prune -a` also clears these mounts.

### 5.5 Add `.dockerignore` files (neither service has one)

Without them, `COPY . .` sends everything to the build context and copies it into the image. That includes `backend/.env`, so **secrets are currently baked into the backend image layers**, plus `__pycache__`, `tests/`, and the 30 `frontend/test_*.test.mjs` files.

`backend/.dockerignore`:

```
.env
.env.*
!.env.example
__pycache__/
*.pyc
tests/
*.md
.git
```

`frontend/.dockerignore`:

```
node_modules
dist
.env
.env.local
*.test.mjs
.git
```

Compose already passes the backend environment through `env_file: ./backend/.env`, and the frontend values through build args, so neither service needs the `.env` files inside the image. Test locally with `docker compose -f docker-compose.prod.yml build` before pushing.

### 5.6 Unused file to clean up

The repo-root `Dockerfile` (unified nginx + Python image) is not used by `docker-compose.prod.yml`, which builds `backend/` and `frontend/` separately. Delete it, or document what it is for, so the team does not edit the wrong file.

### 5.7 Rebuild without paying for a full rebuild

- **Config-only changes** (compose `command`, healthcheck, env vars, ports): `docker compose -f docker-compose.prod.yml up -d --no-build <service>`.
- **Backend source changes only**: `bash scripts/build-images.sh backend`. The dependencies live in a tagged base image (5.8), so this takes seconds even if the build cache was pruned.
- **Frontend**: any source change re-runs `npm run build`. The `npm ci` layer is cached while `package*.json` is unchanged.
- Never build on server2 with `--no-cache` unless a dependency is genuinely corrupted.

### 5.8 Build speed work (2026-10-28): tagged base image, trimmed dependencies

**How a build works now.** `backend/Dockerfile` has two stages. `deps` (system packages, CPU-only PyTorch, `requirements.txt`, the proctoring model) changes only with `requirements.txt`. `runtime` copies the source on top. `scripts/build-images.sh` hashes `requirements.txt` plus the `deps` part of the Dockerfile, builds `interviewer-backend-base:<hash>` once if that tag does not exist, and passes it to compose as `BACKEND_BASE_IMAGE`. Tagged images survive `docker builder prune`, so a pruned build cache can no longer turn a code deploy into a multi-minute build. A plain `docker compose build backend` still works: `BASE_IMAGE` defaults to the inline `deps` stage, it is just slower when the cache is cold.

```bash
bash scripts/build-images.sh                  # all services
bash scripts/build-images.sh backend          # only what changed
docker images 'interviewer-backend-base*'     # old base tags are kept; `docker rmi` the ones you no longer need
```

Run it with `bash`: the exec bit is lost in a tarball. If it fails with `\r: command not found`, the file got CRLF line endings on Windows: `sed -i 's/\r$//' scripts/*.sh` (the repo's `.gitattributes` keeps them LF in git).

**Optional: build off the server.** `bash scripts/ship-images.sh server2 frontend` builds on your machine (linux/amd64) and loads the image on the server with `docker save | ssh | docker load`; then `docker compose -f docker-compose.prod.yml up -d --no-build`. It sends whole images, so ship only what changed (the backend image is about 2.3 GB). Not yet run against server2; check `uname -m` there first.

**What was removed or changed, and why it is safe:**

- `tenacity` (zero imports) and `google-generativeai` (opt-in via `GEMINI_USE_SDK=1`, which is not set; the client falls back to `httpx`).
- OpenCV was installed twice. `ultralytics` requires the full `opencv-python`, which silently overrode the pinned headless build, so production ran **cv2 5.0.0** while `requirements.txt` said 4.10.0.84. The image now keeps only `opencv-python-headless==5.0.0.93`: the same cv2 version, one copy, and `libgl1` is no longer needed. The `requirements.txt` pin was corrected to match what actually ran.
- `yolov8n.pt` is baked into the image (same file `ultralytics` used to download from GitHub in every worker at every start). If the build-time download fails, the service falls back to downloading on first use, as before.
- Frontend: `@types/react`, `@types/react-dom`, ESLint and its three plugins removed (no TypeScript, no ESLint config file, so `npm run lint` could not run). The lockfile went from 487 to 302 packages; no remaining package changed version. `--legacy-peer-deps` is still required: plain `npm ci` fails on this lockfile.
- `chmod -R a+rX dist` now runs in the builder stage instead of a second copy of every file in the final image (the old `logo_main.png` 403 stays fixed; verified).
- Not done on purpose: replacing `ultralytics`/PyTorch with ONNX would change proctoring detections.

**Measured on a developer laptop (Docker Desktop, 12 CPUs, fast network; server2 will differ).** Before = commit `b1a72383`; after = the same commit with the changes above.

| Scenario | Before | After |
| :--- | ---: | ---: |
| Backend, fully cold | 228 s | 241 s |
| Backend, build cache wiped but base image present | 228 s | **2 s** |
| Backend, code-only change | 3 s | 2 s |
| Backend, `requirements.txt` changed | 100 s | 84 s |
| Frontend, fully cold | 57 s | 47 s |
| Frontend, code-only change | 23 s | 25 s |
| Frontend, `package.json` changed | 43 s | 31 s |
| Backend image size | 2.93 GB | 2.31 GB |
| Python packages / site-packages | 91 / 1829 MB | 75 / 1566 MB |

A fully cold backend build is not faster: the dependency trims are offset by the extra OpenCV reinstall and the model download. The gain is that the cold case no longer happens on deploys. The 7-minute build seen on server2 on 2026-10-28 was almost certainly a cold cache (every slow layer ran and the base images were downloaded again; not confirmed on the server). `apt` alone took 144 s there against 11 s on the laptop, which suggests the shared host was also slowing it down.

**Checked for "no change for users and admins":** proctor detections on two sample images are byte-identical between the old and new image; the backend test suite gives the same result in both (1422 passed, and the same 73 tests fail in both, none new); every frontend file is byte-identical to a fresh rebuild of the old inputs; and a full local compose stack on the new images served the app, `logo_main.png`, auth responses, code runs in Python and Java, and proctoring, with no model download at startup.

**Deployed to server2 on 2026-10-28.** The first build there was cold: the base image `interviewer-backend-base:0bae8a61e92f` took 244 s (`apt` 31 s, PyTorch 56 s, `requirements.txt` 82 s, export 56 s) and the backend and frontend images another 100 s, about 6 minutes in total (the earlier all-cold build there took about 7 minutes). The tag is the same hash as on the developer laptop, so it does not depend on the machine or on line endings. The previous images were kept as `interviewer-platform-backend:rollback-pre-build-changes` and `interviewer-platform-frontend:rollback-pre-build-changes`: to roll back, re-tag them as `:latest` and run `docker compose -f docker-compose.prod.yml up -d --no-build --no-deps backend frontend`. Remove them with `docker rmi` once the release has proven itself.

Checked on the server afterwards: all containers healthy; 0 tracebacks, deadlocks or model downloads in the backend log; `/api/proctor/status` returns `ready`; cv2 is 5.0.0; `logo_main.png` returns 200 over HTTPS; Python and Java runs return `Accepted`; the app shell, `/health/live`, and the 401 responses of `/api/auth/me` and a wrong-password login are unchanged; `/.env` returns the HTML page. Not yet checked on the server: a full student session in a browser. From now on a code-only backend deploy reuses the base image; only a change to `requirements.txt` (or the dependency part of `backend/Dockerfile`) rebuilds it, which should take about 4-6 minutes.

### Expected order of work

0. Remove the `roleready.py` bind mount from compose (3.4) once the image is rebuilt with the fix included.
1. 5.5 `.dockerignore` files (minutes, no behaviour change, removes baked-in secrets).
2. 5.3 remove unused npm packages, commit the lockfile.
3. 5.1 CPU-only torch, and confirm the model file question.
4. 5.4 gunicorn timeout, `google-generativeai` decision, cache mounts.
5. One cold rebuild on server2, then compare `docker images` sizes and record the new numbers here.

---

## 6. Hardening Checklist

### 6.1 Database credentials are in the repo

`docker-compose.prod.yml` hard-codes `DB_PASSWORD=InterviewerPass2026` for the backend and uses it as the MySQL root password default. Move these into an untracked `.env` next to the compose file (compose reads it automatically for `${...}` substitution), use separate root and app passwords, and rotate the current one.

### 6.2 Secrets in the image

See 5.5. After adding `.dockerignore`, rebuild the backend image and delete the old image from server2 so the old layers holding `backend/.env` do not linger.

### 6.3 Authentication settings (local auth, replaces Clerk)

Clerk is gone. Accounts live in the `users` table and sessions in `auth_sessions`. Settings in `backend/.env`:

- `DEBUG=False` (or `ENVIRONMENT=production`) makes the app treat itself as production: the JWT secret is enforced and the session cookie is `Secure`. With `DEBUG=True` the signing key silently falls back to a public placeholder, so never run the server that way.
- `JWT_SECRET_KEY`: at least 32 characters, or the backend refuses to start in production.
- `ADMIN_INITIAL_PASSWORD` (optional, first run only): password for a freshly provisioned `admin@thirdeyedata.ai`. Unset means the account is created locked (2.6). Remove it after first use.
- `SESSION_TTL_HOURS` (default 12) and `SESSION_IDLE_MINUTES` (default 120) set the absolute and idle session lifetime.
- `CLERK_*`, `PLATFORM_ADMIN_CLERK_USER_ID` and `ADMIN_DEFAULT_PASSWORD` are no longer read. `VITE_CLERK_PUBLISHABLE_KEY` was removed from the compose build args.

Anyone who knew the old default admin password (`ThirdEyeAdmin@2026!`) must not be able to use it: on an upgraded database replace it immediately (2.6), on a fresh database it never exists.

### 6.4 CORS and URLs

Compose already sets `FRONTEND_URL` and `CORS_ORIGINS` to `https://interviewer.learningpath.ai`. If login or API calls fail after a domain or Cloudflare change, check these first.

---

## 7. Verification Checklist

```bash
docker compose -f docker-compose.prod.yml ps                  # all Up, backend healthy
docker logs interviewer_backend --since 5m | tail -30          # no tracebacks
curl -s http://127.0.0.1:8212/health/live                      # {"status":"alive",...}
curl -I https://interviewer.learningpath.ai                    # 200 over HTTPS
curl -s https://interviewer.learningpath.ai/health/live
```

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://interviewer.learningpath.ai/api/auth/me    # 401 without a session
curl -s -X POST https://interviewer.learningpath.ai/api/auth/login/ -H 'Content-Type: application/json' \
  -d '{"username":"nobody@example.com","password":"x"}'                                    # {"detail":"Incorrect username or password"}, 404 means a stale proxy (3.7)
```

In the browser: sign in as the admin (email + password), open an assessment, and test one Gemini-backed feature and one voice interview. Watch `docker logs -f interviewer_backend` while testing.
