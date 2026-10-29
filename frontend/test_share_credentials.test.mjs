import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModule } from './test_support/bundle.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf-8');
const rel = (c) => `${c.method.toUpperCase()} ${c.url.replace('http://api.test', '')}`;
const PAGE = read('src/pages/admin/UserManagementPage.jsx').replace(/\r\n/g, '\n');

describe('User Management: Share credentials (UI)', () => {
    beforeEach(() => { (globalThis.__axiosCalls ||= []).length = 0; globalThis.__axiosResponse = {}; globalThis.__axiosHandler = undefined; });

    test('API: Share posts to the account only; no e-mail, no password, no recipient travels from the browser', async () => {
        const { userManagementApi } = await loadModule('src/services/userManagementApi.js');
        globalThis.__axiosResponse = { status: 'sent', message: 'Login credentials were sent.' };
        const res = await userManagementApi.shareCredentials(42);
        const [call] = globalThis.__axiosCalls;
        assert.equal(rel(call), 'POST /api/admin/users/42/share-credentials');
        assert.deepEqual(call.body, {}, 'the server takes the recipient and the password from its own records');
        assert.ok(!('Authorization' in call.headers), 'the HttpOnly session cookie is the credential');
        assert.equal(res.status, 'sent');
        assert.ok(call.timeout >= 30000, 'sending an e-mail may take a few seconds');
    });

    test('server refusals are readable and machine-classifiable', async () => {
        const { apiError, shareFailureCode } = await loadModule('src/services/userManagementApi.js');
        const err = (status, detail) => ({ response: { status, data: { detail } } });
        const notAvailable = err(409, { code: 'PASSWORD_NOT_AVAILABLE', message: 'Use Replace password first.' });
        assert.equal(shareFailureCode(notAvailable), 'PASSWORD_NOT_AVAILABLE');
        assert.equal(apiError(notAvailable), 'Use Replace password first.');
        assert.equal(apiError(err(502, { code: 'EMAIL_UNAVAILABLE', message: 'Could not connect to the mail server. Nothing was changed; you can try again.' })),
            'Could not connect to the mail server. Nothing was changed; you can try again.');
        assert.equal(shareFailureCode(err(403, 'plain string')), '');
        assert.equal(apiError(err(403, 'Login credentials can only be shared for student accounts.')), 'Login credentials can only be shared for student accounts.');
        assert.equal(apiError(err(422, ['Value error, Enter a valid e-mail address.'])), 'Enter a valid e-mail address.', 'existing handling is unchanged');
    });

    test('Share is offered for student accounts, and for admin accounts to a Super Admin, beside the existing actions, in the design system', () => {
        assert.ok(PAGE.includes('{canShare && ('), 'Share only where canShare is true');
        assert.ok(PAGE.includes("const canShare = canManage && (u.role === 'STUDENT' || (u.role === 'ADMIN' && manageableRoles(me?.role).includes('ADMIN')));"), 'students always, admins only when the signed-in user may manage admins; Super Admin rows never');
        // the existing actions are all still there
        assert.ok(PAGE.includes('aria-label={`View ${u.email}`}') && PAGE.includes('aria-label={`Replace password for ${u.email}`}'));
        assert.ok(PAGE.includes("`${u.is_active ? 'Deactivate' : 'Activate'} ${u.email}`"));
        const button = PAGE.slice(PAGE.indexOf('{canShare && ('), PAGE.indexOf('aria-label={`Replace password for'));
        assert.ok(button.includes('className={ghostBtn}'), 'same button style as the other actions');
        assert.ok(button.includes('<Mail size={14} />') && button.includes('Share'));
        assert.ok(button.includes('animate-spin') && button.includes('Sending...'), 'loading state');
        assert.ok(button.includes('disabled={sharingId !== null || !u.is_active}'), 'disabled while a send is running and for deactivated accounts');
        assert.ok(button.includes('aria-busy'));
    });

    test('a double click cannot send twice; the handler holds no password and keeps nothing in the browser', () => {
        const handler = PAGE.slice(PAGE.indexOf('const shareCredentials = async'), PAGE.indexOf('return (\n        <WorkspacePage'));
        assert.ok(handler.includes('if (sharingRef.current) return;') && handler.includes('sharingRef.current = true'));
        assert.ok(handler.includes('sharingRef.current = false') && handler.includes('finally'), 'released on success and on failure');
        assert.ok(handler.includes('userManagementApi.shareCredentials(target.id)'), 'only the account id is sent');
        assert.ok(!/password/i.test(handler.replace(/Replace password|PASSWORD_NOT_AVAILABLE/g, '')), 'no password in the Share handler');
        assert.ok(!/localStorage|sessionStorage/.test(handler));
        assert.ok(handler.includes('say(res.message)') && handler.includes("say(apiError(err, 'The credentials could not be sent. Please try again.'), 'error')"), 'real success and failure feedback');
    });

    test('an unavailable password sends the admin to Replace password: Share never changes a password itself', () => {
        assert.ok(PAGE.includes("shareFailureCode(err) === 'PASSWORD_NOT_AVAILABLE'") && PAGE.includes('setNeedsReplace(target)'));
        assert.ok(PAGE.includes("title=\"Password can't be shared yet\"") && PAGE.includes('confirmText="Replace password"'));
        assert.ok(PAGE.includes("setDialog({ type: 'reset', user: target })"), 'confirming opens the existing Replace password dialog');
        const handler = PAGE.slice(PAGE.indexOf('const shareCredentials = async'), PAGE.indexOf('return (\n        <WorkspacePage'));
        assert.ok(!handler.includes('resetPassword'), 'Share itself never replaces a password');
        // after create / replace the admin is told what to do next
        assert.ok(PAGE.includes('Click Share to e-mail the login details to the student.') && PAGE.includes('Click Share to e-mail the new password to the student.'));
    });

    test('no notification system, and the other User Management actions are untouched', () => {
        assert.ok(!/notification|Notification/.test(PAGE));
        for (const call of ['userManagementApi.deactivate', 'userManagementApi.activate', 'userManagementApi.resetPassword', 'userManagementApi.create', 'userManagementApi.update']) {
            assert.ok(PAGE.includes(call), call);
        }
    });
});
