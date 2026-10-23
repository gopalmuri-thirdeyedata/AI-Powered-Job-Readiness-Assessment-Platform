import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModule } from './test_support/bundle.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf-8');

const role = (id, status, state, expires = '2030-01-16T09:00:00+00:00') => ({
    id, title: `Role ${id}`, status, share_link_state: state, share_link_expires_at: expires,
    share_path: state === 'ACTIVE' ? `/assessment/join/t${id}` : null,
});

const withBrowserClock = async (iso, fn) => {
    const real = Date.now;
    Date.now = () => new Date(iso).getTime();
    try { return await fn(); } finally { Date.now = real; }
};

describe('Recruitment shared links: 24-hour expiry (admin UI)', () => {
    beforeEach(() => { (globalThis.__axiosCalls ||= []).length = 0; globalThis.__axiosResponse = {}; });

    test('expired links are hidden from the active list; live and manually closed ones stay', async () => {
        const { activeLinkRoles, expiredLinkRoles, isLinkLive } = await loadModule('src/components/admin/shareLinks.js');
        const roles = [
            role(1, 'PUBLISHED', 'ACTIVE'), role(2, 'PUBLISHED', 'EXPIRED'), role(3, 'CLOSED', 'CLOSED'),
            role(4, 'CLOSED', 'EXPIRED'), role(5, 'DRAFT', null, null),
        ];
        assert.deepEqual(activeLinkRoles(roles).map((r) => r.id), [1, 3]);
        assert.deepEqual(expiredLinkRoles(roles).map((r) => r.id), [2, 4]);
        assert.deepEqual(roles.filter(isLinkLive).map((r) => r.id), [1], 'a closed link is not "live"');
    });

    test('the browser clock cannot change what is shown: only the server-evaluated state is used', async () => {
        const { activeLinkRoles, expiryNote } = await loadModule('src/components/admin/shareLinks.js');
        const roles = [role(1, 'PUBLISHED', 'ACTIVE'), role(2, 'PUBLISHED', 'EXPIRED')];
        const fmt = (iso) => `at ${iso}`;
        const baseline = [activeLinkRoles(roles).map((r) => r.id), expiryNote(roles[0], fmt)];
        for (const fake of ['1990-01-01T00:00:00Z', '2030-01-15T09:00:00Z', '2099-12-31T23:59:59Z']) {
            const seen = await withBrowserClock(fake, () => [activeLinkRoles(roles).map((r) => r.id), expiryNote(roles[0], fmt)]);
            assert.deepEqual(seen, baseline, `identical output with the browser clock at ${fake}`);
        }
        const src = read('src/components/admin/shareLinks.js');
        assert.ok(!/Date\.now|new Date\(|performance\.now/.test(src), 'shareLinks.js never reads the browser clock');
    });

    test('refreshing re-reads the server value: the displayed expiry is the stored timestamp, never recomputed', async () => {
        const { expiryNote } = await loadModule('src/components/admin/shareLinks.js');
        const r = role(1, 'PUBLISHED', 'ACTIVE', '2030-01-16T09:00:00+00:00');
        const fmt = (iso) => `Expires<${iso}>`;
        const first = expiryNote(r, fmt);
        const later = await withBrowserClock('2030-01-15T20:00:00Z', () => expiryNote(r, fmt));
        assert.equal(first, 'Expires Expires<2030-01-16T09:00:00+00:00>');
        assert.equal(later, first);
        assert.match(expiryNote({ ...r, status: 'CLOSED', share_link_state: 'CLOSED' }, fmt), /^Reopening keeps the original expiry: /);
        assert.match(expiryNote({ ...r, share_link_expires_at: null }, fmt), /No expiry .*24-hour window/, 'legacy links are labelled, not shown as expiring');
    });

    test('creating a new link calls the dedicated, admin-authenticated endpoint', async () => {
        globalThis.localStorage = { getItem: (k) => (k === 'token' ? 'ADMIN-JWT' : null), setItem() {}, removeItem() {} };
        const { adminApi } = await loadModule('src/services/recruitmentApi.js');
        await adminApi.newShareLink(7);
        await adminApi.publishRole(7);
        const seen = globalThis.__axiosCalls.map((c) => `${c.method.toUpperCase()} ${c.url.replace('http://api.test', '')}`);
        assert.deepEqual(seen, ['POST /api/admin/job-roles/7/new-link', 'POST /api/admin/job-roles/7/publish']);
        assert.ok(globalThis.__axiosCalls.every((c) => c.headers.Authorization === 'Bearer ADMIN-JWT'));
    });

    test('overview prompts for a new link when the only link expired, and never offers an expired link for copying', async () => {
        const { nextAction } = await loadModule('src/components/admin/OverviewKpis.jsx');
        const expiredOnly = nextAction([role(1, 'PUBLISHED', 'EXPIRED')], { total_registrations: 0 });
        assert.equal(expiredOnly.key, 'renew');
        assert.equal(expiredOnly.cta.tab, 'roles');
        assert.equal(expiredOnly.published, undefined);
        const mixed = nextAction([role(1, 'PUBLISHED', 'EXPIRED'), role(2, 'PUBLISHED', 'ACTIVE')], { total_registrations: 0 });
        assert.equal(mixed.key, 'share');
        assert.deepEqual(mixed.published.map((r) => r.id), [2]);
        assert.equal(nextAction([role(1, 'PUBLISHED', 'EXPIRED')], { total_registrations: 3 }).key, 'review', 'results of an expired link stay reachable');
    });

    test('Shared Links wiring: filtered list, expiry shown, reopen goes through the server rule, hint to create a new link', () => {
        const links = read('src/components/admin/SharedLinkManager.jsx');
        assert.ok(links.includes('activeLinkRoles(allRoles)') && links.includes('expiredLinkRoles(allRoles)'));
        assert.ok(links.includes('data-testid="link-expiry"') && links.includes('expiryNote(role, formatDate)'));
        assert.ok(links.includes('adminApi.publishRole'), 'reopen is a server call; the server answers 410 for an expired link');
        assert.ok(links.includes("onNavigate('roles')") && links.includes('expired-links-note'));
        const roles = read('src/components/admin/JobRoleManager.jsx');
        assert.ok(roles.includes('adminApi.newShareLink') && roles.includes('Create new link') && roles.includes('isLinkExpired(role)'));
    });

    test('candidates see the server message for an expired link on every public page', () => {
        for (const f of ['SharedAssessmentEntry', 'ExamInstructions', 'RecruitmentAssessmentPage']) {
            assert.ok(read(`src/pages/candidate/${f}.jsx`).includes('err.response.data.detail'), `${f} shows the 410 detail`);
        }
    });

    test('the RoleReady invitation screens are untouched by link expiry', () => {
        for (const f of ['src/pages/roleready/RoleReadyAssessment.jsx', 'src/services/assessmentApi.js']) {
            assert.ok(!read(f).includes('share_link_state') && !read(f).includes('shareLinks'), `${f} does not know about link expiry`);
        }
    });
});
