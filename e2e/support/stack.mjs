// Starts the real backend (harness/serve.py, scratch database) and the real Vite frontend on free ports, and stops them again.
// Nothing here touches backend/PrepWin.db and nothing is deployed anywhere.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(here, '..', '..');
const isWin = process.platform === 'win32';

const freePort = () => new Promise((resolve, reject) => {
  const srv = net.createServer();
  srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  srv.on('error', reject);
});

const waitFor = async (url, { timeoutMs = 90000, label = url } = {}) => {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) {
    try { const r = await fetch(url); if (r.status < 500) return; last = r.status; } catch (e) { last = e.message; }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`${label} did not become ready: ${last}`);
};

const pythonBin = () => process.env.E2E_PYTHON
  || [path.join(REPO, 'backend', 'venv', 'Scripts', 'python.exe'), path.join(REPO, 'backend', 'venv', 'bin', 'python')].find((p) => fs.existsSync(p))
  || 'python';

export const chromePath = () => process.env.E2E_CHROME
  || ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
    .find((p) => fs.existsSync(p));

const kill = (child) => {
  if (!child || child.exitCode !== null) return;
  if (isWin) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
};

/**
 * @param {object} [opts]
 * @param {boolean} [opts.liveVapi]  use the real Vapi REST API for assistant creation (billable; off by default)
 */
export async function startStack(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prepwin-e2e-'));
  const apiPort = await freePort();
  const webPort = await freePort();
  const api = `http://127.0.0.1:${apiPort}`;
  const web = `http://127.0.0.1:${webPort}`;   // same host as the API: the session cookie is SameSite=Lax
  const logs = { api: path.join(dir, 'api.log'), web: path.join(dir, 'web.log') };
  const children = [];

  const backend = spawn(pythonBin(), [path.join(REPO, 'e2e', 'harness', 'serve.py')], {
    cwd: path.join(REPO, 'backend'),
    env: {
      ...process.env, PORT: String(apiPort), E2E_DIR: dir, DATABASE_URL: `sqlite:///${path.join(dir, 'e2e.db').replace(/\\/g, '/')}`,
      CORS_ORIGINS: `${web},http://127.0.0.1:${webPort}`, FRONTEND_URL: web, E2E_LIVE_VAPI: opts.liveVapi ? '1' : '',
      PYTHONIOENCODING: 'utf-8',
    },
    stdio: ['ignore', fs.openSync(logs.api, 'w'), fs.openSync(logs.api, 'a')],
  });
  children.push(backend);

  const vite = spawn(process.execPath, [path.join(REPO, 'frontend', 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(webPort), '--strictPort', '--host', '127.0.0.1'], {
    cwd: path.join(REPO, 'frontend'),
    env: { ...process.env, VITE_API_URL: api, VITE_VAPI_CONNECT_TIMEOUT_MS: String(opts.connectTimeoutMs || 8000) },
    stdio: ['ignore', fs.openSync(logs.web, 'w'), fs.openSync(logs.web, 'a')],
  });
  children.push(vite);

  const stop = () => { children.forEach(kill); try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp files */ } };
  try {
    await waitFor(`${api}/openapi.json`, { label: 'backend' });
    await waitFor(`${web}/`, { label: 'frontend' });
  } catch (err) {
    const tail = (f) => { try { return fs.readFileSync(f, 'utf8').slice(-1500); } catch { return ''; } };
    stop();
    throw new Error(`${err.message}\n--- api log ---\n${tail(logs.api)}\n--- web log ---\n${tail(logs.web)}`);
  }

  const call = async (method, route, { token, json } = {}) => {
    const res = await fetch(`${api}${route}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(json ? { 'Content-Type': 'application/json' } : {}) },
      body: json ? JSON.stringify(json) : undefined,
    });
    const text = await res.text();
    let body; try { body = JSON.parse(text); } catch { body = text; }
    return { status: res.status, body };
  };

  return {
    api, web, dir, call, stop,
    advance: (seconds) => call('POST', `/__e2e/advance?seconds=${seconds}`),
    info: () => call('GET', '/__e2e/info').then((r) => r.body),
    session: (uuid) => call('GET', `/__e2e/session/${uuid}`).then((r) => r.body),
    async newOrg(tag) {
      const admin = (await call('POST', `/__e2e/org-admin?tag=${tag}`)).body;
      const job = (await call('POST', `/__e2e/seed-job?admin_token=${admin.token}`)).body;
      return { ...admin, ...job };
    },
    async newStudent(tag) { return (await call('POST', `/__e2e/student?tag=${tag}`)).body; },
    /** A student account of the org's own organization, created through the real admin API (what an administrator does). */
    async newOrgStudent(org, name = 'E2E Student') {
      const tag = `${Date.now()}.${Math.floor(Math.random() * 1e6)}`;
      const email = `e2e.student.${tag}@students.prepwin-e2e.com`;
      const password = 'Zx9#pLm2!qWe-4417';
      const r = await call('POST', '/api/admin/users/', { token: org.token, json: { role: 'STUDENT', full_name: name, email, password } });
      if (r.status !== 201) throw new Error(`could not create the e2e student: ${r.status} ${JSON.stringify(r.body)}`);
      return { name, email, password };
    },
  };
}
