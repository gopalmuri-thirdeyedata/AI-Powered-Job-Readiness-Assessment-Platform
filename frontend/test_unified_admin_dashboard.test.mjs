import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadModule } from './test_support/bundle.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf-8');

const dashboardSrc = read('src/pages/Dashboard.jsx');
const layoutSrc = read('src/layouts/DashboardLayout.jsx');
const appSrc = read('src/App.jsx');
const rolesSrc = read('src/components/admin/JobRoleManager.jsx');
const linksSrc = read('src/components/admin/SharedLinkManager.jsx');
const tableSrc = read('src/components/admin/CandidateResultsTable.jsx');
const modalSrc = read('src/components/admin/CandidateReportModal.jsx');
const kpiSrc = read('src/components/admin/OverviewKpis.jsx');
const linkFieldSrc = read('src/components/admin/SharedLinkField.jsx');
const adminComponents = { rolesSrc, linksSrc, tableSrc, modalSrc, kpiSrc };

const makeLocalStorage = (initial = {}) => {
    const m = new Map(Object.entries(initial));
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), dump: () => Object.fromEntries(m) };
};

describe('Admin API client (real endpoints, cookie session + tenant header)', () => {
    beforeEach(() => { (globalThis.__axiosCalls ||= []).length = 0; globalThis.__axiosResponse = { items: [] }; });

    test('1. every admin call hits the real backend route with the cookie session (no bearer header, nothing in storage)', async () => {
        globalThis.localStorage = makeLocalStorage();
        const { adminApi } = await loadModule('src/services/recruitmentApi.js');
        await adminApi.listRoles();
        await adminApi.getRole(7);
        await adminApi.createRole({ title: 'T', description: 'D' });
        await adminApi.updateRole(7, { description: 'x' });
        await adminApi.generateBlueprint(7);
        await adminApi.publishRole(7);
        await adminApi.closeRole(7);
        await adminApi.overview();
        await adminApi.listCandidates({ page: 2, status: 'COMPLETED' });
        await adminApi.dossier(9);
        await adminApi.revokeRegistration(9);
        await adminApi.authorizeRetake(9, 'verified outage');
        await adminApi.rejectReview(9, 'no evidence');
        await adminApi.retryEvaluation(9);
        const seen = globalThis.__axiosCalls.map((c) => `${c.method.toUpperCase()} ${c.url.replace('http://api.test', '')}`);
        assert.deepEqual(seen, [
            'GET /api/admin/job-roles/', 'GET /api/admin/job-roles/7', 'POST /api/admin/job-roles/', 'PUT /api/admin/job-roles/7',
            'POST /api/admin/job-roles/7/generate-blueprint', 'POST /api/admin/job-roles/7/publish', 'POST /api/admin/job-roles/7/close',
            'GET /api/admin/recruitment/overview-stats', 'GET /api/admin/recruitment/candidates', 'GET /api/admin/recruitment/candidates/9/dossier',
            'POST /api/admin/recruitment/registrations/9/revoke', 'POST /api/admin/recruitment/candidates/9/authorize-retake',
            'POST /api/admin/recruitment/candidates/9/reject-review', 'POST /api/admin/recruitment/candidates/9/retry-evaluation',
        ]);
        assert.ok(globalThis.__axiosCalls.every((c) => !('Authorization' in c.headers)), 'the HttpOnly cookie (+ CSRF header from the auth client) is the credential');
        assert.deepEqual(globalThis.__axiosCalls[8].params, { page: 2, status: 'COMPLETED' });
        assert.deepEqual(globalThis.__axiosCalls[11].body, { justification: 'verified outage' });
        assert.ok(globalThis.__axiosCalls[4].timeout >= 60000, 'blueprint generation allows for Gemini latency');
        assert.deepEqual(globalThis.localStorage.dump?.() ?? {}, {}, 'no credential is stored client side');
        delete globalThis.localStorage;
    });

    test('2. the tenant header comes from the server-verified session (org of the signed-in admin); students and anonymous send none', async () => {
        const { adminApi, refreshSession } = await loadModule('test_support/adminSessionHarness.js');
        const signInAs = async (me) => {
            globalThis.fetch = async () => ({ ok: Boolean(me), json: async () => me });
            await refreshSession();
        };
        await signInAs({ user_id: 1, email: 'a@x.test', role: 'ADMIN', organization_id: 42, csrf_token: 'C1' });
        await adminApi.listRoles();
        assert.equal(globalThis.__axiosCalls.at(-1).headers['X-Organization-Id'], '42');
        await signInAs({ user_id: 1, email: 'a@x.test', role: 'ADMIN', organization_id: null, csrf_token: 'C1' });
        await adminApi.listRoles();
        assert.ok(!('X-Organization-Id' in globalThis.__axiosCalls.at(-1).headers));
        await signInAs({ user_id: 2, email: 's@x.test', role: 'STUDENT', organization_id: 42, csrf_token: 'C2' });
        await adminApi.listRoles();
        assert.ok(!('X-Organization-Id' in globalThis.__axiosCalls.at(-1).headers), 'a student session never selects an admin tenant');
        await signInAs(null);
        await adminApi.listRoles();
        assert.ok(!('X-Organization-Id' in globalThis.__axiosCalls.at(-1).headers));
        delete globalThis.fetch;
    });
});

describe('Shared admin UI helpers render real values', () => {
    test('3. every backend status has a badge and nulls render as an em dash, never a fake zero', async () => {
        const ui = await loadModule('src/components/admin/adminUi.jsx');
        for (const status of ['REGISTERED', 'IN_PROGRESS', 'COMPLETED', 'TIMED_OUT', 'ABANDONED', 'EVALUATION_PENDING', 'INFRASTRUCTURE_FAILURE', 'MANUAL_REVIEW_REQUIRED', 'REVOKED_RETRIED', 'DRAFT', 'PUBLISHED', 'CLOSED']) {
            assert.ok(ui.STATUS_META[status], `badge meta for ${status}`);
            const markup = renderToStaticMarkup(React.createElement(ui.StatusBadge, { status }));
            assert.ok(markup.includes(ui.STATUS_META[status].label), `badge text for ${status}`);
        }
        assert.equal(ui.formatScore(null), '—');
        assert.equal(ui.formatScore(undefined), '—');
        assert.equal(ui.formatScore(66.666), '66.7%');
        assert.equal(ui.formatScore(0), '0.0%');
        assert.equal(ui.formatDuration(125), '2m 05s');
        assert.equal(ui.formatDuration(null), '—');
        assert.equal(ui.formatDate(null), '—');
    });

    test('4. link copying uses the clipboard API and falls back safely when it is unavailable', async () => {
        const ui = await loadModule('src/components/admin/adminUi.jsx');
        let copied = null;
        Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async (t) => { copied = t; } } }, configurable: true });
        assert.equal(await ui.copyText('https://x.test/assessment/join/abc'), true);
        assert.equal(copied, 'https://x.test/assessment/join/abc');
        Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async () => { throw new Error('denied'); } } }, configurable: true });
        assert.equal(await ui.copyText('x'), false, 'no DOM available here: reports failure instead of throwing');
    });

    test('5. the toast announces success and errors accessibly', async () => {
        const ui = await loadModule('src/components/admin/adminUi.jsx');
        const ok = renderToStaticMarkup(React.createElement(ui.Toast, { toast: { message: 'Assessment link copied to clipboard.' }, onClose: () => {} }));
        assert.match(ok, /role="status"/);
        assert.match(ok, /link copied/);
        const bad = renderToStaticMarkup(React.createElement(ui.Toast, { toast: { type: 'error', message: 'Nope' }, onClose: () => {} }));
        assert.match(bad, /text-red-700/);
        assert.equal(renderToStaticMarkup(React.createElement(ui.Toast, { toast: null, onClose: () => {} })), '');
    });

    test('6. KPI overview shows loading placeholders, not invented numbers, before the API answers', async () => {
        const { default: Kpis } = await loadModule('src/components/admin/OverviewKpis.jsx');
        const html = renderToStaticMarkup(React.createElement(Kpis, {}));
        assert.match(html, /Recruitment Overview/);
        assert.match(html, /animate-pulse/);
        assert.doesNotMatch(html, /Active Jobs/, 'tiles only render once real data arrives');
    });
});

describe('Admin dashboard structure and requirements', () => {
    test('7. the four workflow stages are separate routes (one page each), not in-page tabs', async () => {
        const routes = await loadModule('src/components/admin/workflowRoutes.js');
        assert.deepEqual(routes.WORKFLOW_ROUTES, { overview: '/admin/dashboard', roles: '/admin/job-roles', links: '/admin/shared-links', results: '/admin/candidate-results', users: '/admin/users' });
        const pages = {
            roles: ['src/pages/admin/JobRolesPage.jsx', '<JobRoleManager', 'Job Roles & Blueprints'],
            links: ['src/pages/admin/SharedLinksPage.jsx', '<SharedLinkManager', 'Shared Links'],
            results: ['src/pages/admin/CandidateResultsPage.jsx', '<CandidateResultsTable', 'Candidate Results'],
            users: ['src/pages/admin/UserManagementPage.jsx', 'userManagementApi', 'User Management'],
        };
        for (const [, [file, comp, title]] of Object.entries(pages)) {
            const src = read(file);
            assert.ok(src.includes(comp) && src.includes(`title="${title}"`) && src.includes('WorkspacePage'), `${file} renders ${comp}`);
        }
        assert.ok(dashboardSrc.includes('<OverviewKpis') && !/<JobRoleManager|<SharedLinkManager|<CandidateResultsTable/.test(dashboardSrc), 'Overview renders only the overview');
        assert.ok(dashboardSrc.includes('Create job assessments, share assessment links, and review candidate results.'));
        assert.ok(!dashboardSrc.includes('Upload student resumes'), 'the page no longer describes the email-invitation flow');
        for (const kept of ['Assessment Management']) assert.ok(dashboardSrc.includes(kept), `existing title preserved: ${kept}`);
        assert.ok(read('src/components/admin/WorkspacePage.jsx').includes('PrepWin Admin Workspace'));
        // no horizontal workflow tabs anywhere
        for (const [name, src] of [['Dashboard', dashboardSrc], ['WorkspacePage', read('src/components/admin/WorkspacePage.jsx')]]) {
            assert.ok(!src.includes('aria-label="Recruitment workspace"') && !/WORKFLOW_TABS|aria-current/.test(src), `${name} has no tab navigation`);
        }
        // old bookmarks (?tab=roles|links|results) redirect to the new routes
        assert.ok(dashboardSrc.includes('legacyTab') && dashboardSrc.includes('<Navigate to={WORKFLOW_ROUTES[legacyTab]} replace />'));
        // the empty states / next-step buttons navigate with the same helper
        for (const src of [dashboardSrc, ...['JobRolesPage', 'SharedLinksPage', 'CandidateResultsPage'].map((n) => read(`src/pages/admin/${n}.jsx`))]) {
            assert.ok(src.includes('useWorkflowNavigate') && src.includes('onNavigate={goTo}'));
        }
        assert.ok(!dashboardSrc.includes('dispatchBatch') && !dashboardSrc.includes('getTrackingData'), 'no email-invitation code remains');
        for (const [path, comp] of [['/admin/dashboard', 'Dashboard'], ['/admin/job-roles', 'JobRolesPage'], ['/admin/shared-links', 'SharedLinksPage'], ['/admin/candidate-results', 'CandidateResultsPage']]) {
            assert.ok(appSrc.includes(`<Route path="${path}" element={<${comp} />} />`), `${path} is routed`);
        }
        const guarded = appSrc.slice(appSrc.indexOf('<AdminGuard><DashboardLayout />'), appSrc.indexOf('Candidate Portal Routes'));
        for (const path of ['/admin/dashboard', '/admin/job-roles', '/admin/shared-links', '/admin/candidate-results']) assert.ok(guarded.includes(`path="${path}"`), `${path} is admin-guarded`);
    });

    test('7b. modules outside the recruitment workflow are gone from the admin UI and their URLs land on the workspace', () => {
        const removed = ['/recruitment/rounds', '/recruitment/invitations', '/resume-screening', '/screened-candidates', '/coding-round', '/aptitude-round', '/technical-interview', '/candidates', '/analytics', '/settings'];
        for (const route of removed) {
            assert.ok(appSrc.includes(`<Route path="${route}" element={<Navigate to="/admin/dashboard" replace />} />`), `${route} redirects to the workspace`);
        }
        for (const page of ['ResumeScreening', 'ScreenedCandidates', 'RecruitmentRoundsManager', 'InvitationAssessments', 'GlobalSettings', "pages/Analytics'", 'CodingRound', 'AptitudeRound', 'TechnicalInterview', "pages/Candidates'"]) {
            assert.ok(!appSrc.includes(page), `${page} is no longer loaded by the app`);
        }
        assert.ok(!fs.existsSync(path.join(__dirname, 'src/pages/InvitationAssessments.jsx')));
        const navbarSrc = read('src/components/GlobalNavbar.jsx');
        assert.ok(!navbarSrc.includes('Notification') && !navbarSrc.includes('Bell'), 'the legacy activity-notification bell is removed');
        assert.ok(!navbarSrc.includes('>\n                        Admin Workspace'), 'no second "Admin Workspace" link next to the sidebar entry');
    });

    test('8. sidebar: the four workflow stages plus the Administration > User Management entry, no legacy modules and no Organizations', () => {
        assert.ok(layoutSrc.includes('PrepWin Assessment Suite'));
        const labels = [...layoutSrc.matchAll(/<SidebarItem icon=\{(\w+)\} label="([^"]+)" path=\{?([^\s}]+)\}?/g)].map((m) => [m[1], m[2], m[3]]);
        assert.deepEqual(labels.map((l) => l[1]), ['Overview', 'Job Roles & Blueprints', 'Shared Links', 'Candidate Results', 'User Management']);
        assert.deepEqual(labels.slice(0, 4).map((l) => l[0]), ['LayoutDashboard', 'Briefcase', 'Link2', 'ClipboardList'], 'icons');
        assert.deepEqual(labels.slice(0, 4).map((l) => l[2]), ['WORKFLOW_ROUTES.overview', 'WORKFLOW_ROUTES.roles', 'WORKFLOW_ROUTES.links', 'WORKFLOW_ROUTES.results']);
        assert.deepEqual([labels[4][0], labels[4][2]], ['UserCog', 'WORKFLOW_ROUTES.users'], 'User Management lives under its own Administration heading');
        assert.ok(layoutSrc.includes('Administration'));
        for (const gone of ['Recruitment Workspace', 'Candidate Results & Dossiers', 'Admin Workspace', 'Resume Screening', 'Screened Candidates', 'Assessment Rounds', 'Invitation Assessments', 'Recruitment Analytics',
            'Enterprise Settings', 'Talent Screening Suite', 'Platform & Settings', 'Platform &amp; Settings', 'tab=']) {
            assert.ok(!layoutSrc.includes(gone), `removed from the sidebar: ${gone}`);
        }
        // each item is active only on its own route (Overview also on the /dashboard alias)
        assert.ok(layoutSrc.includes('location.pathname === path') && layoutSrc.includes("location.pathname === '/dashboard'"));
        for (const gone of ['Organizations', 'Building2', 'PLATFORM_ADMIN', '/platform/', '>Platform<']) assert.ok(!layoutSrc.includes(gone), `no platform / organizations navigation: ${gone}`);
        assert.equal((layoutSrc.match(/<SidebarItem icon=/g) || []).length, 5, 'no role-specific extra entries');
        assert.ok(!layoutSrc.includes('Recruitment Pipeline'));
        assert.ok(!/Recruiter Login|HR Login|Org Admin Login|College Admin Login/i.test(layoutSrc + appSrc), 'only Student and Admin logins exist');
        const guarded = appSrc.slice(appSrc.indexOf('<AdminGuard><DashboardLayout />'), appSrc.indexOf('Candidate Portal Routes'));
        assert.ok(guarded.includes('path="/admin/dashboard"'));
        assert.ok(guarded.includes('path="/admin/users"'), 'User Management is inside the admin guard');
    });

    test('8a. the sidebar is fixed width: collapse / expand only, no resize handle, state or listeners', () => {
        for (const gone of ['sidebarWidth', 'setSidebarWidth', 'isResizing', 'startResizing', 'stopResizing', 'col-resize', 'Drag to resize', "addEventListener('mousemove'", "addEventListener('mouseup'", 'document.body.style.cursor']) {
            assert.ok(!layoutSrc.includes(gone), `resize code removed: ${gone}`);
        }
        assert.ok(layoutSrc.includes('SIDEBAR_WIDTH_EXPANDED = 280') && layoutSrc.includes('SIDEBAR_WIDTH_COLLAPSED = 84'));
        assert.ok(layoutSrc.includes('animate={{ width: isSidebarOpen ? SIDEBAR_WIDTH_EXPANDED : SIDEBAR_WIDTH_COLLAPSED }}'));
        assert.ok(layoutSrc.includes('aria-label={isSidebarOpen ? "Collapse sidebar" : "Expand sidebar"}') && layoutSrc.includes('setSidebarOpen(!isSidebarOpen)'), 'collapse / expand control kept');
        assert.ok(layoutSrc.includes('<main className="flex-1 min-w-0'), 'content area flexes with the sidebar');
        assert.ok(layoutSrc.includes('aria-label="Mobile Navigation"') && layoutSrc.includes('setIsMobileMenuOpen'), 'mobile drawer kept');
        assert.ok(layoutSrc.includes('layoutId={`active-pill-${scope}`}') && layoutSrc.includes("'drawer')") && layoutSrc.includes("'desktop')"), 'drawer and desktop sidebar do not share one animated highlight (it stalled the drawer exit)');
        assert.ok(!layoutSrc.includes('layoutId="active-pill"'));
    });

    test('8b. the Platform Organizations feature is gone from the UI; its old URL lands on Overview', () => {
        assert.ok(!fs.existsSync(path.join(__dirname, 'src/pages/PlatformAdminDashboard.jsx')), 'page removed');
        assert.ok(!appSrc.includes('PlatformAdminDashboard'), 'no import of the removed page');
        assert.ok(appSrc.includes('<Route path="/platform/organizations" element={<Navigate to="/admin/dashboard" replace />} />'), 'old bookmarks do not 404');
        const navbarSrc = read('src/components/GlobalNavbar.jsx');
        assert.ok(!navbarSrc.includes('to="/platform/organizations"'), 'no navbar link to it');
        // nothing in the UI source calls the platform-organizations API any more
        const walk = (dir) => fs.readdirSync(path.join(__dirname, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));
        const offenders = walk('src').filter((f) => /\.(jsx?|mjs)$/.test(f)).filter((f) => /api\/platform\/organizations|Suspend Organization|PlatformAdminDashboard/.test(read(f)));
        assert.deepEqual(offenders, []);
    });

    test('9. admin components are backed by the real API with no mock data', () => {
        for (const [name, src] of Object.entries(adminComponents)) {
            assert.ok(src.includes("from '../../services/recruitmentApi'"), `${name} uses the API client`);
            assert.ok(!/mock|faker|lorem|dummy|Math\.random/i.test(src), `${name} has no mock data`);
        }
        assert.ok(!/axios/.test(Object.values(adminComponents).join('\n')), 'components go through the service layer');
    });

    test('10. job roles own create / generate / review / publish: JD validation, failure handling, publish guard', () => {
        assert.ok(rolesSrc.includes('const MIN_JD_CHARS = 50'));
        assert.ok(rolesSrc.includes('adminApi.generateBlueprint') && rolesSrc.includes('Nothing was changed'));
        assert.ok(rolesSrc.includes('genErrors[role.id]') && rolesSrc.includes('role="alert"'), 'a generation failure stays on the role card, not only in a 4-second toast');
        assert.ok(rolesSrc.includes('disabled={!hasValidBlueprint || !!b}'), 'cannot publish without a valid blueprint');
        assert.ok(rolesSrc.includes('adminApi.publishRole') && rolesSrc.includes("role.status === 'DRAFT'"), 'publishing happens here, for drafts');
        assert.ok(rolesSrc.includes('role.blueprint?.valid'));
        assert.ok(!rolesSrc.includes('adminApi.closeRole'), 'closing the link is owned by Shared Links, not duplicated here');
        assert.equal((rolesSrc.match(/<ConfirmationModal/g) || []).length, 0, 'no confirmation dialog is needed on this screen');
        assert.ok(rolesSrc.includes("onNavigate('links')"), 'a published role leads to its shared link');
        assert.ok(!rolesSrc.includes('correct_key') || rolesSrc.includes('q.correct_key'), 'answer keys are shown to admins only in the review panel');
    });

    test('11. shared links own the one reusable link per assessment: copy, preview, close, reopen', () => {
        assert.ok(linksSrc.includes('SharedLinkField') && linkFieldSrc.includes('copyText(url)'));
        assert.ok(linksSrc.includes('Assessment link copied to clipboard.'));
        assert.ok(linkFieldSrc.includes('window.location.origin') && linkFieldSrc.includes('readOnly') && linkFieldSrc.includes('Copy link'));
        assert.ok(linksSrc.includes("role.status === 'PUBLISHED'"));
        assert.ok(linksSrc.includes('adminApi.closeRole') && linksSrc.includes('<ConfirmationModal'));
        assert.ok(linksSrc.includes('adminApi.publishRole'), 'reopening a closed link');
        assert.ok(linksSrc.includes('No shared links yet') && linksSrc.includes("onNavigate('roles')"), 'empty state leads to publishing');
        assert.ok(kpiSrc.includes('SharedLinkField'), 'the overview reuses the same link component instead of re-implementing copy');
    });

    test('11b. the next-step guidance follows the real workflow state (no jobs -> blueprint -> publish -> share -> review)', async () => {
        const { nextAction } = await loadModule('src/components/admin/OverviewKpis.jsx');
        const none = { total_registrations: 0 };
        assert.equal(nextAction([], none).key, 'create');
        assert.equal(nextAction([{ id: 1, title: 'A', status: 'DRAFT', blueprint: null }], none).key, 'blueprint');
        assert.equal(nextAction([{ id: 1, title: 'A', status: 'DRAFT', blueprint: { valid: false } }], none).key, 'blueprint');
        assert.equal(nextAction([{ id: 1, title: 'A', status: 'DRAFT', blueprint: { valid: true } }], none).key, 'publish');
        const shared = nextAction([{ id: 1, title: 'A', status: 'PUBLISHED', blueprint: { valid: true }, share_path: '/assessment/join/x' }], none);
        assert.equal(shared.key, 'share');
        assert.equal(shared.published.length, 1);
        assert.equal(shared.cta.tab, 'links');
        const review = nextAction([{ id: 1, title: 'A', status: 'PUBLISHED' }], { total_registrations: 3 });
        assert.equal(review.key, 'review');
        assert.equal(review.cta.tab, 'results');
        assert.match(review.body, /3 candidates have registered/);
    });

    test('11c. results empty states mirror the real backend state and lead to the next step', () => {
        for (const needle of ['No job roles yet', 'No published assessment yet', 'No candidates have registered yet.', 'No candidates match these filters.', 'Clear filters', "go('roles'", "go('links'", 'rolesLoaded']) {
            assert.ok(tableSrc.includes(needle), `results empty state: ${needle}`);
        }
        assert.ok(tableSrc.includes('<ErrorBanner') && tableSrc.includes('<LoadingRow'), 'loading, error and empty states are distinct');
    });

    test('12. candidate results: server-side search, filters, sorting and pagination', () => {
        for (const needle of ['search', 'job_role_id', 'status', 'sort', 'order', 'page_size', 'adminApi.listCandidates(params)', 'reqRef', 'Previous page', 'Next page', 'No candidates match these filters.']) {
            assert.ok(tableSrc.includes(needle), `results table: ${needle}`);
        }
        assert.ok(tableSrc.includes('INCOMPLETE') && tableSrc.includes('never receive a fabricated overall score'));
        assert.ok(tableSrc.includes('<CandidateReportModal'));
        assert.ok(tableSrc.includes('formatScore(r.aptitude_score)') && tableSrc.includes('formatScore(r.overall_score)'));
    });

    test('13. dossier modal: contact, section scores, timeline, question review, audited actions, print/export', () => {
        for (const needle of ['data.candidate.email', 'data.candidate.phone', 'Overall (equal weight)', 'Timeline', 'Aptitude review', 'Coding review', 'Interview responses', 'window.print()', 'exportJson', 'adminApi.dossier', 'self-reported and unverified']) {
            assert.ok(modalSrc.includes(needle), `dossier: ${needle}`);
        }
        assert.ok(modalSrc.includes('text.length < 10') && modalSrc.includes('audit log'), 'retake/reject need a recorded justification');
        assert.ok(modalSrc.includes('data.actions.can_authorize_retake') && modalSrc.includes('data.actions.can_revoke') && modalSrc.includes('data.actions.can_retry_evaluation'));
        assert.ok(modalSrc.includes('@media print'));
        assert.ok(modalSrc.includes("report.overall_score === null ? 'INCOMPLETE'"), 'incomplete assessments show INCOMPLETE, never a fabricated overall');
        assert.ok(modalSrc.includes('role="dialog"'));
    });

    test('14. PrepWin design tokens with light and dark themes are used throughout', () => {
        for (const [name, src] of Object.entries(adminComponents)) {
            assert.ok(src.includes('#5d8c2c') || src.includes('adminUi'), `${name} uses brand green directly or via shared tokens`);
            assert.ok(src.includes('dark:') || src.includes('cardCls') || src.includes('ghostBtn') || src.includes('primaryBtn'), `${name} supports dark mode`);
        }
        const ui = read('src/components/admin/adminUi.jsx');
        for (const token of ['#5d8c2c', '#4c7324', 'dark:bg-slate-900', 'dark:border-slate-800', 'dark:text-slate-100']) assert.ok(ui.includes(token), token);
        assert.ok(!/#[0-9a-f]{6}/i.test(modalSrc.replace(/#5d8c2c|#4c7324|#9fd05a/gi, '')), 'no stray hard-coded colours that break a theme');
    });
});
