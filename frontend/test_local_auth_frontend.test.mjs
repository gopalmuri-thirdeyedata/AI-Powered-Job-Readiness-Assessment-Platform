// Local authentication (Clerk removed) in the browser code: behaviour of the session client + structural guarantees of the UI.
import { describe, test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModule } from './test_support/bundle.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf-8');
const API = 'http://api.test';

// ---- browser stand-ins -------------------------------------------------------------------------------------------------------
const makeStorage = (writes) => {
    const store = {};
    const define = (name, fn) => Object.defineProperty(store, name, { value: fn, enumerable: false });
    define('getItem', (k) => (k in store ? store[k] : null));
    define('setItem', (k, v) => { writes.push([k, String(v)]); store[k] = String(v); });
    define('removeItem', (k) => { delete store[k]; });
    return store;
};

let fetchCalls = [];
let fetchHandler;
let storageWrites;

// fetch is stubbed ONCE: the auth client wraps window.fetch the first time it is installed, so replacing it per test would drop the wrapper.
const installFetchStub = () => {
    globalThis.fetch = async (url, init = {}) => {
        const headers = new Headers(init.headers || {});
        fetchCalls.push({ url: String(url), method: (init.method || 'GET').toUpperCase(), headers, credentials: init.credentials, body: init.body });
        const out = await fetchHandler({ url: String(url), method: (init.method || 'GET').toUpperCase(), body: init.body ? JSON.parse(init.body) : undefined });
        return { ok: out.status >= 200 && out.status < 300, status: out.status, json: async () => out.body };
    };
    globalThis.window = globalThis;
};

const freshStorage = () => {
    storageWrites = [];
    globalThis.localStorage = makeStorage(storageWrites);
    globalThis.sessionStorage = makeStorage(storageWrites);
    fetchCalls.length = 0;
};

const ME = { user_id: 7, email: 'ada@example.com', full_name: 'Ada Lovelace', phone: null, role: 'STUDENT', is_active: true, organization_id: 3, csrf_token: 'csrf-abc' };

describe('session client (auth/authSession.js)', () => {
    let auth;
    before(async () => { installFetchStub(); auth = await loadModule('src/auth/authSession.js'); });
    beforeEach(() => {
        freshStorage();
        fetchHandler = async ({ url }) => (url.endsWith('/api/auth/me') ? { status: 200, body: ME } : { status: 404, body: {} });
    });

    test('1. initAuth asks the server who the cookie belongs to, with credentials, and keeps only an in-memory summary', async () => {
        await auth.initAuth();
        const me = fetchCalls.find((c) => c.url === `${API}/api/auth/me`);
        assert.ok(me, 'GET /api/auth/me');
        assert.equal(me.credentials, 'include');
        const { user, isLoaded, csrfToken } = auth.getAuthState();
        assert.equal(isLoaded, true);
        assert.equal(user.role, 'STUDENT');
        assert.equal(user.email, 'ada@example.com');
        assert.equal(csrfToken, 'csrf-abc');
        assert.deepEqual(storageWrites, [], 'nothing is written to localStorage / sessionStorage');
    });

    test('2. an anonymous visitor (401) is loaded-but-signed-out; a network failure is reported, not treated as signed out silently', async () => {
        fetchHandler = async () => ({ status: 401, body: { detail: 'Not authenticated' } });
        await auth.refreshSession();
        assert.deepEqual([auth.getAuthState().isLoaded, auth.getAuthState().user, auth.getAuthState().csrfToken], [true, null, null]);
        fetchHandler = async () => { throw new TypeError('network down'); };
        await auth.refreshSession();
        assert.equal(auth.getAuthState().error, 'network');
    });

    test('3. login posts the normalized e-mail, stores nothing, and returns the server-chosen role and redirect', async () => {
        fetchHandler = async ({ url }) => (url.endsWith('/api/auth/login/')
            ? { status: 200, body: { user: { ...ME, role: 'ADMIN' }, role: 'ADMIN', redirect: '/admin/dashboard', csrf_token: 'csrf-admin' } }
            : { status: 404, body: {} });
        const data = await auth.login('  Admin@Example.COM ', 'S3cret-Passw0rd!');
        const call = fetchCalls.find((c) => c.url === `${API}/api/auth/login/`);
        assert.equal(call.method, 'POST');
        assert.deepEqual(JSON.parse(call.body), { email: 'admin@example.com', password: 'S3cret-Passw0rd!' });
        assert.equal(call.headers.get('Content-Type'), 'application/json');
        assert.equal(data.redirect, '/admin/dashboard');
        assert.equal(auth.getAuthState().user.role, 'ADMIN');
        assert.equal(auth.getAuthState().csrfToken, 'csrf-admin');
        assert.deepEqual(storageWrites, [], 'no password, token or profile is persisted in the browser');
        assert.equal(JSON.stringify(auth.getAuthState()).includes('S3cret'), false, 'the password is not retained in state');
    });

    test('4. a rejected login surfaces the server message and leaves the session untouched (401 generic, 429 rate limit)', async () => {
        await auth.logout();
        fetchHandler = async () => ({ status: 401, body: { detail: 'Invalid email or password.' } });
        await assert.rejects(() => auth.login('a@b.co', 'x'), /Invalid email or password\./);
        fetchHandler = async () => ({ status: 429, body: { detail: 'Too many failed sign-in attempts. Please wait a few minutes and try again.' } });
        await assert.rejects(() => auth.login('a@b.co', 'x'), /Too many failed sign-in attempts/);
        assert.equal(auth.getAuthState().user, null);
    });

    test('5. state-changing fetches to the API carry cookies + the CSRF token; other origins and safe methods do not', async () => {
        await auth.initAuth();                                // installs the client and loads csrf-abc
        fetchCalls.length = 0;
        fetchHandler = async () => ({ status: 200, body: {} });
        await window.fetch(`${API}/api/student/profile`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        await window.fetch(`${API}/api/student/profile`);
        await window.fetch('https://elsewhere.example/api/x', { method: 'POST', body: '{}' });
        const [put, get, foreign] = fetchCalls;
        assert.equal(put.headers.get('X-CSRF-Token'), 'csrf-abc');
        assert.equal(put.credentials, 'include');
        assert.equal(get.headers.get('X-CSRF-Token'), null);
        assert.equal(foreign.headers.get('X-CSRF-Token'), null, 'the token is never sent to another origin');
        assert.notEqual(foreign.credentials, 'include');
    });

    test('6. axios requests get credentials + CSRF on unsafe API calls only', async () => {
        await auth.initAuth();
        const [reqInterceptor] = globalThis.__axiosInterceptors.request;
        assert.equal(typeof reqInterceptor, 'function');
        const post = reqInterceptor({ method: 'post', url: `${API}/api/admin/users/`, headers: {} });
        assert.equal(post.headers['X-CSRF-Token'], 'csrf-abc');
        assert.equal(reqInterceptor({ method: 'get', url: `${API}/api/admin/users/`, headers: {} }).headers['X-CSRF-Token'], undefined);
        assert.equal(reqInterceptor({ method: 'post', url: 'https://elsewhere.example/x', headers: {} }).headers['X-CSRF-Token'], undefined);
        assert.equal(globalThis.__axiosDefaults.withCredentials, true);
    });

    test('7. a 401 on an authenticated API call re-reads the session so the guards redirect', async () => {
        await auth.initAuth();
        fetchCalls.length = 0;
        fetchHandler = async () => ({ status: 401, body: {} });
        const [, onRejected] = globalThis.__axiosInterceptors.response;
        await assert.rejects(() => onRejected({ config: { url: `${API}/api/student/profile` }, response: { status: 401 } }));
        await new Promise((r) => setTimeout(r, 10));
        assert.ok(fetchCalls.some((c) => c.url === `${API}/api/auth/me`));
        assert.equal(auth.getAuthState().user, null);
    });

    test('8. logout ends the server session, clears memory and removes leftover legacy credentials', async () => {
        await auth.initAuth();
        ['admin_token', 'student_token', 'studentToken', 'token', 'user_profile'].forEach((k) => localStorage.setItem(k, 'legacy'));
        fetchCalls.length = 0;
        fetchHandler = async () => ({ status: 200, body: { message: 'Signed out.' } });
        await auth.logout();
        const call = fetchCalls.find((c) => c.url === `${API}/api/auth/logout/`);
        assert.equal(call.method, 'POST');
        assert.equal(call.credentials, 'include');
        assert.equal(auth.getAuthState().user, null);
        assert.equal(auth.getAuthState().csrfToken, null);
        ['admin_token', 'student_token', 'studentToken', 'token', 'user_profile'].forEach((k) => assert.equal(localStorage.getItem(k), null, k));
    });

    test('9. starting up purges tokens that earlier versions left in the browser', async () => {
        localStorage.setItem('admin_token', 'old-admin-jwt');
        localStorage.setItem('studentToken', 'old-student-jwt');
        fetchHandler = async () => ({ status: 401, body: {} });
        await auth.initAuth();
        assert.equal(localStorage.getItem('admin_token'), null);
        assert.equal(localStorage.getItem('studentToken'), null);
    });
});

describe('structure: no Clerk, no sign-up, one login, no stored credentials', () => {
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
    const srcFiles = walk(path.join(__dirname, 'src')).filter((f) => /\.(js|jsx)$/.test(f));

    test('10. nothing under src imports or mentions Clerk; the dependency and build config are gone too', () => {
        const offenders = srcFiles.filter((f) => /clerk/i.test(fs.readFileSync(f, 'utf-8'))).map((f) => path.relative(__dirname, f));
        assert.deepEqual(offenders, []);
        const pkg = JSON.parse(read('package.json'));
        assert.equal(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).some((d) => d.includes('clerk')), false);
        assert.equal(/clerk/i.test(read('vite.config.js')), false);
    });

    test('11. there is no sign-up route, page, link or API call anywhere', () => {
        const app = read('src/App.jsx');
        assert.equal(/path="\/signup"|path="\/register"|auth=signup|auth=register/.test(app), false);
        for (const f of srcFiles) {
            const text = fs.readFileSync(f, 'utf-8');
            const rel = path.relative(__dirname, f);
            assert.equal(/auth\/register|auth=signup|SignUp\b/.test(text) || />\s*Sign up\s*</i.test(text), false, `${rel} must not offer sign-up`);
        }
        assert.equal(/\/api\/student\/auth\//.test(read('src/services/studentApi.js')), false);
    });

    test('12. the single login asks for e-mail and password only and trusts the server for the destination', () => {
        const modal = read('src/components/LoginModal.jsx');
        assert.match(modal, /type="email"/);
        assert.match(modal, /type=\{showPassword \? 'text' : 'password'\}/);
        assert.match(modal, /autoComplete="current-password"/);
        assert.match(modal, /from '\.\.\/auth\/authSession'/);
        assert.match(modal, /data\.redirect/);
        assert.equal(/<select|value="(ADMIN|STUDENT)"|role_intent|roleIntent/.test(modal), false, 'the login form has no role selector / client-side role');
        assert.equal(/localStorage|sessionStorage/.test(modal), false);
        const routes = read('src/App.jsx');
        for (const legacy of ['/login', '/admin/login', '/student/login']) {
            assert.match(routes, new RegExp(`path="${legacy}" element=\\{<Navigate to="/\\?auth=login" replace />\\}`));
        }
    });

    test('13. service clients and layouts never read or attach a stored credential', () => {
        for (const f of ['src/services/studentApi.js', 'src/services/collegeApi.js', 'src/services/recruitmentApi.js', 'src/services/rolereadyApi.js', 'src/services/userManagementApi.js']) {
            const text = read(f);
            assert.equal(/Authorization/.test(text.replace(/\/\/.*$/gm, '')), false, `${f} must not build Authorization headers`);
            assert.equal(/localStorage\.getItem\('(student_?[tT]oken|admin_token|token)'\)/.test(text), false, f);
        }
        const store = read('src/utils/authStorage.js');
        assert.equal(/setItem\(/.test(store), false, 'authStorage writes nothing');
        assert.equal(/(Token|token)/.test(store.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), false, 'authStorage has no token handling');
        for (const f of srcFiles.map((p) => path.relative(__dirname, p)).filter((p) => /^src\/(layouts|components|hooks|auth)\//.test(p.replace(/\\/g, '/')))) {
            assert.equal(/localStorage\.setItem\('(student_?[tT]oken|admin_token|token)'/.test(read(f)), false, `${f} must not persist a token`);
        }
    });

    test('14. admin guard, admin-only routes and the Users page are wired; students and anonymous users are redirected', () => {
        const app = read('src/App.jsx');
        assert.match(app, /<AdminGuard><DashboardLayout \/><\/AdminGuard>/);
        assert.match(app, /path="\/admin\/users" element=\{<UserManagementPage \/>\}/);
        const guard = read('src/components/AdminGuard.jsx');
        assert.match(guard, /useAuth/);
        assert.match(guard, /isAdminRole\(user\.role\)/);
        assert.match(guard, /'\/\?auth=login'/);
        const student = read('src/layouts/StudentLayout.jsx');
        assert.match(student, /navigate\('\/\?auth=login'/);
        assert.match(student, /isAdminRole\(role\)/);
        const rr = read('src/components/RoleReadyAuthGuard.jsx');
        assert.match(rr, /role === 'STUDENT'/);
    });

    test('15. User Management offers exactly the specified fields and keeps passwords out of lists and storage', () => {
        const page = read('src/pages/admin/UserManagementPage.jsx');
        for (const label of ['Role', 'Name', 'Email', 'Password', 'Mobile number (optional)']) assert.ok(page.includes(`"${label}"`) || page.includes(`label="${label}"`) || page.includes(`>${label}<`), label);
        assert.match(page, /STUDENT/);
        assert.match(page, /ADMIN/);
        assert.match(page, /Search by name or email/);
        assert.match(page, /Filter by role/);
        assert.match(page, /Deactivate/);
        assert.match(page, /Replace password/);
        assert.equal(/localStorage|sessionStorage/.test(page), false);
        assert.equal(/\.password|hashed/i.test(page.slice(page.indexOf('data.items.map'), page.indexOf('</tbody>'))), false, 'the users table never renders a password or hash');
        assert.match(page, /setForm\(\{ role: 'STUDENT', fullName: '', email: '', password: '', phone: '' \}\)/, 'the password field is cleared after creation');
        const nav = read('src/layouts/DashboardLayout.jsx');
        assert.match(nav, /label="User Management" path=\{WORKFLOW_ROUTES\.users\}/);
    });

    test('16. the User Management API client targets the admin-only endpoints and mirrors the password policy', async () => {
        freshStorage();
        globalThis.__axiosCalls = [];
        globalThis.__axiosHandler = () => ({ items: [], total: 0, user: {} });
        const mod = await loadModule('src/services/userManagementApi.js');
        await mod.userManagementApi.list({ q: ' ada ', role: 'STUDENT', isActive: true, page: 2 });
        await mod.userManagementApi.create({ role: 'ADMIN', fullName: 'A B', email: 'a@b.co', password: 'Str0ng-Passw0rd!', phone: '' });
        await mod.userManagementApi.resetPassword(5, 'Another-Passw0rd!');
        const [list, create, reset] = globalThis.__axiosCalls;
        assert.equal(list.url, `${API}/api/admin/users/`);
        assert.deepEqual(list.params, { page: 2, page_size: 25, q: 'ada', role: 'STUDENT', is_active: true });
        assert.deepEqual(create.body, { role: 'ADMIN', full_name: 'A B', email: 'a@b.co', password: 'Str0ng-Passw0rd!', phone: null });
        assert.equal(reset.url, `${API}/api/admin/users/5/reset-password`);
        assert.equal(Object.keys(list.headers).some((h) => h.toLowerCase() === 'authorization'), false);
        assert.deepEqual(mod.passwordProblems('Str0ng-Passw0rd!', 'ada@x.com'), []);
        assert.ok(mod.passwordProblems('short', 'ada@x.com').length >= 3);
        assert.ok(mod.passwordProblems('Adalovelace12', 'adalovelace@x.com').includes('no part of the e-mail name'));
        assert.equal(mod.apiError({ response: { data: { detail: ['Password must contain a digit.', 'Password is too common.'] } } }), 'Password must contain a digit. Password is too common.');
        assert.equal(mod.apiError({ response: { status: 409, data: { detail: 'An account with this e-mail address already exists.' } } }), 'An account with this e-mail address already exists.');
    });
});

describe('three-role hierarchy in the UI (the server remains the authority)', () => {
    test('17. role helpers mirror the permission matrix: Super Admin creates all roles, Admin creates Students only, Student nothing', async () => {
        const r = await loadModule('src/auth/roles.js');
        assert.deepEqual(r.creatableRoles('SUPER_ADMIN'), ['STUDENT', 'ADMIN', 'SUPER_ADMIN']);
        assert.deepEqual(r.creatableRoles('ADMIN'), ['STUDENT']);
        assert.deepEqual(r.creatableRoles('STUDENT'), []);
        assert.deepEqual(r.creatableRoles(undefined), []);
        assert.equal(r.isAdminRole('SUPER_ADMIN') && r.isAdminRole('ADMIN'), true);
        assert.equal(r.isAdminRole('STUDENT') || r.isAdminRole('CANDIDATE') || r.isAdminRole(null), false);
        assert.equal(r.isSuperAdmin('ADMIN'), false);
    });

    test('18. every guard and layout treats ADMIN and SUPER_ADMIN as administrators and never trusts a client role', () => {
        for (const f of ['src/components/AdminGuard.jsx', 'src/components/PublicNavbar.jsx', 'src/components/RoleReadyAuthGuard.jsx', 'src/layouts/CollegeLayout.jsx', 'src/layouts/StudentLayout.jsx', 'src/pages/Home.jsx', 'src/utils/authStorage.js']) {
            assert.match(read(f), /isAdminRole/, f);
            assert.equal(/role === 'ADMIN'|role !== 'ADMIN'/.test(read(f)), false, `${f} must not compare against ADMIN alone`);
        }
        assert.match(read('src/components/LoginModal.jsx'), /data\.role === 'STUDENT'/);
    });

    test('19. the Create account form offers only the roles the signed-in role may create, and hides management for the rest', () => {
        const page = read('src/pages/admin/UserManagementPage.jsx');
        assert.match(page, /allowedRoles=\{creatableRoles\(me\?\.role\)\}/);
        assert.match(page, /allowedRoles\.includes\(value\)/);
        assert.match(page, /manageableRoles\(me\?\.role\)\.includes\(u\.role\)/);
        assert.match(page, /SUPER_ADMIN/);
        assert.match(read('src/layouts/DashboardLayout.jsx'), /User Management/);
    });
});
