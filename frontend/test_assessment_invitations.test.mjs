import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModule } from './test_support/bundle.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf-8');
const rel = (c) => `${c.method.toUpperCase()} ${c.url.replace('http://api.test', '')}`;

describe('E-mail invitations: Share with Students (admin UI)', () => {
    beforeEach(() => { (globalThis.__axiosCalls ||= []).length = 0; globalThis.__axiosResponse = {}; globalThis.__axiosHandler = undefined; });

    test('API: list and send use the job-role endpoints with the cookie session and the selected ids only', async () => {
        const { adminApi } = await loadModule('src/services/recruitmentApi.js');
        await adminApi.listShareStudents(7, 'maya');
        await adminApi.listShareStudents(7);
        await adminApi.sendInvitations(7, [3, 5]);
        const [list, listAll, sendCall] = globalThis.__axiosCalls;
        assert.equal(rel(list), 'GET /api/admin/job-roles/7/share-students');
        assert.deepEqual(list.params, { q: 'maya' });
        assert.equal(listAll.params, undefined);
        assert.equal(rel(sendCall), 'POST /api/admin/job-roles/7/invitations');
        assert.deepEqual(sendCall.body, { student_ids: [3, 5] }, 'recipients are identified by id; the server looks the address up');
        assert.ok(globalThis.__axiosCalls.every((c) => !('Authorization' in c.headers)));
        assert.ok(sendCall.timeout >= 60000, 'sending several e-mails may take a while');
    });

    test('large selections are split to the server limit of 50 per request', async () => {
        const { chunk, INVITE_CHUNK } = await loadModule('src/components/admin/ShareWithStudents.jsx');
        assert.equal(INVITE_CHUNK, 50);
        const ids = Array.from({ length: 120 }, (_, i) => i + 1);
        assert.deepEqual(chunk(ids).map((c) => c.length), [50, 50, 20]);
        assert.deepEqual(chunk(ids).flat(), ids, 'nothing lost, nothing repeated, order kept');
        assert.deepEqual(chunk([]), []);
    });

    test('status never claims delivery: "Sent" means accepted by the mail server', async () => {
        const { statusOf } = await loadModule('src/components/admin/ShareWithStudents.jsx');
        const sent = statusOf({ invitation: { status: 'SENT' } });
        assert.equal(sent.label, 'Sent');
        assert.match(sent.hint, /not confirmed/i);
        assert.equal(statusOf({ invitation: null }), null);
        assert.deepEqual([statusOf({ invitation: { status: 'FAILED', error: 'boom' } }).key, statusOf({ invitation: { status: 'PENDING' } }).key], ['FAILED', 'PENDING']);
    });

    test('the outcome of the latest send beats the stored status, and failures keep their reason for retry', async () => {
        const { statusOf } = await loadModule('src/components/admin/ShareWithStudents.jsx');
        const student = { id: 1, invitation: { status: 'SENT' } };
        assert.equal(statusOf(student, { status: 'failed', reason: 'The mail server refused this recipient address.' }).key, 'FAILED');
        const failed = statusOf({ id: 2, invitation: null }, { status: 'failed', reason: 'Could not connect to the mail server.' });
        assert.equal(failed.hint, 'Could not connect to the mail server.');
        const skipped = statusOf({ id: 3, invitation: null }, { status: 'skipped', reason: 'Already sent for this link.' });
        assert.equal(skipped.label, 'Already sent');
    });

    test('panel offers search, per-student checkboxes, select all, selected count and Send Invitation', () => {
        const src = read('src/components/admin/ShareWithStudents.jsx');
        for (const needle of ['Share with Students', 'Search students by name or email', 'type="checkbox"', 'aria-label="Select all students"',
            'data-testid="selected-count"', '{selected.size} selected', 'Send Invitation', 'Retry failed', 's.email', 's.name',
            'adminApi.listShareStudents', 'adminApi.sendInvitations', 'data-testid="send-summary"']) {
            assert.ok(src.includes(needle), `ShareWithStudents must contain ${needle}`);
        }
        assert.ok(src.includes('disabled={!canSend || sending || selected.size === 0}'), 'no double submit, nothing to send without a selection');
        assert.ok(src.includes('E-mail sending is not configured'), 'a missing SMTP setup is explained, with manual sharing as the way out');
    });

    test('there is no in-app notification system: the feature is e-mail only', () => {
        const src = read('src/components/admin/ShareWithStudents.jsx');
        for (const banned of ['Notification', 'notification', 'bell', 'Bell', 'badge-count']) {
            assert.ok(!src.includes(banned), `ShareWithStudents must not contain ${banned}`);
        }
    });

    test('manual sharing is untouched: Copy link / Preview / expiry stay, and the panel is an optional toggle', () => {
        const field = read('src/components/admin/SharedLinkField.jsx');
        assert.ok(field.includes('Copy link') && field.includes('Preview') && field.includes('copyText(url)'));
        assert.ok(!field.includes('ShareWithStudents') && !field.includes('invitation'), 'the link field knows nothing about invitations');
        const links = read('src/components/admin/SharedLinkManager.jsx');
        assert.ok(links.includes('<SharedLinkField role={role} onCopy={onCopied} />'), 'link field still rendered for every published role');
        assert.ok(links.includes('expiryNote(role, formatDate)') && links.includes('data-testid="link-expiry"'));
        assert.ok(links.includes('Share with Students') && links.includes('shareOpenId === role.id && <ShareWithStudents'), 'panel only appears when asked for');
        assert.ok(links.includes("role.status === 'PUBLISHED' && shareOpenId"), 'only a published (live) assessment can be shared');
    });
});
