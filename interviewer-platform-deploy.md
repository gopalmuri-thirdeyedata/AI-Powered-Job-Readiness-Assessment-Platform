# AI-Powered Job Readiness Assessment Platform (interviewer.learningpath.ai) - Operational Runbook

Deployment runbook for **AI-Powered Job Readiness Assessment Platform** (branch `PrepWin`) on `server2` (`139.99.62.133`), served at **`https://interviewer.learningpath.ai`** with host entrypoint port **`8212`**.

Last updated: 2026-10-14. Sections 1-4 describe how to deploy and operate the stack. Section 5 lists the changes the team should make to cut build time and image size.

---

## 1. System Architecture & Port Allocation

| Component | Host Port | Container Port | Container Name | Image / Service | Description |
| :--- | :---: | :---: | :--- | :--- | :--- |
| **Edge Proxy** | **8212** | 80 | `interviewer_proxy` | `nginx:alpine` | Internal routing proxy (`/api/` -> backend, `/` -> frontend) |
| **Backend** | - | 8000 | `interviewer_backend` | FastAPI (Python 3.11) | Gunicorn + Uvicorn workers, Gemini AI, resume parsing, YOLO proctoring |
| **Frontend** | - | 80 | `interviewer_frontend` | React + Vite (Node 20 build, nginx serve) | Assessment SPA with Clerk auth and ElevenLabs voice |
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
    .

scp interviewer_platform.tar.gz server2:~/interviewer_platform.tar.gz
```

`backend/.env` is inside this archive. Do not upload the archive anywhere else, and delete it from the server after extracting.

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

---

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

   Remove the mount line after the next rebuild, since the fix will then be in the image.

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
- Clerk warns that development keys are in use. See 6.3.

### 3.6 Requests for `/.env`, `/.env.local` and similar in the proxy logs

Automated scanners probe these paths. They return `200` because the SPA falls back to `index.html` for unknown paths. Confirm that no secrets are served:

```bash
curl -s https://interviewer.learningpath.ai/.env | head -5     # must print HTML, never KEY=value lines
```

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

6. **Clerk:** add `https://interviewer.learningpath.ai` to the allowed origins and redirect URLs in the Clerk dashboard.
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
- **Backend source changes only**: `docker compose -f docker-compose.prod.yml build backend`. The `pip install` layer is cached as long as `requirements.txt` has not changed.
- **Frontend**: any source change re-runs `npm run build`. The `npm ci` layer is cached while `package*.json` is unchanged.
- Never build on server2 with `--no-cache` unless a dependency is genuinely corrupted.

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

### 6.3 Clerk is on development keys

The frontend is built with a `pk_test_...` publishable key. For real use, create a Clerk **production** instance, add `interviewer.learningpath.ai` to it, and replace the key in the compose build args (frontend, needs a rebuild) and the secret key in `backend/.env`.

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

In the browser: sign in with Clerk, open an assessment, and test one Gemini-backed feature and one voice interview. Watch `docker logs -f interviewer_backend` while testing.
