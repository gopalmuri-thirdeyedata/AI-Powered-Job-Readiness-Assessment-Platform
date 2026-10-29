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

describe('User Management: Bulk Share Credentials (UI)', () => {
    beforeEach(() => {
        (globalThis.__axiosCalls ||= []).length = 0;
        globalThis.__axiosResponse = {};
        globalThis.__axiosHandler = undefined;
    });

    test('API: bulkShareCredentials posts user_ids list to /api/admin/users/share-credentials/bulk', async () => {
        const { userManagementApi } = await loadModule('src/services/userManagementApi.js');
        globalThis.__axiosResponse = {
            total: 2,
            sent: 2,
            failed: 0,
            skipped: 0,
            results: [
                { id: 101, name: 'Student One', email: 's1@example.com', status: 'sent', message: 'Credentials sent.' },
                { id: 102, name: 'Student Two', email: 's2@example.com', status: 'sent', message: 'Credentials sent.' },
            ],
        };

        const res = await userManagementApi.bulkShareCredentials([101, 102]);
        const [call] = globalThis.__axiosCalls;
        assert.equal(rel(call), 'POST /api/admin/users/share-credentials/bulk');
        assert.deepEqual(call.body, { user_ids: [101, 102] });
        assert.ok(!('Authorization' in call.headers), 'HttpOnly session cookie is used');
        assert.equal(res.total, 2);
        assert.equal(res.sent, 2);
        assert.ok(call.timeout >= 60000, 'sufficient timeout for batch processing');
    });

    test('Checkboxes are rendered only for eligible accounts (students; admins for a Super Admin), never for Super Admin rows', () => {
        // Row checkbox condition
        assert.ok(PAGE.includes("const canShare = canManage && (u.role === 'STUDENT' || (u.role === 'ADMIN' && manageableRoles(me?.role).includes('ADMIN'))); const isEligibleStudent = canShare;"));
        assert.ok(PAGE.includes('{isEligibleStudent ? ('));
        assert.ok(PAGE.includes('id={`select-user-${u.id}`}') || PAGE.includes('id={`select-student-${u.id}}'));

        // Displayed eligible filter: students, and admins the signed-in user may manage
        assert.ok(PAGE.includes("(u.role === 'STUDENT' || u.role === 'ADMIN')") && PAGE.includes('displayedEligible'));
    });

    test('Select-all checkbox targets currently displayed eligible students with count display', () => {
        assert.ok(PAGE.includes('id="select-all-students"'));
        assert.ok(PAGE.includes('aria-label="Select all eligible students on this page"'));
        assert.ok(PAGE.includes('el.indeterminate = !allSelected && someSelected;'));
        assert.ok(PAGE.includes('selectedIds.length === 1 ? \'account\' : \'accounts\'} selected'));
        assert.ok(PAGE.includes('Clear selection'));
    });

    test('Share Credentials button enables when students are selected and triggers confirmation modal', () => {
        assert.ok(PAGE.includes('id="bulk-share-header-btn"') || PAGE.includes('id="bulk-share-credentials-btn"'));
        assert.ok(PAGE.includes('disabled={selectedIds.length === 0 || bulkSending}'));
        assert.ok(PAGE.includes('onClick={() => setBulkConfirmOpen(true)}'));
        assert.ok(PAGE.includes('isOpen={bulkConfirmOpen}'));
    });

    test('Progress indicator and duplicate submission prevention (bulkRef) during send', () => {
        assert.ok(PAGE.includes('bulkRef.current = true') && PAGE.includes('bulkRef.current = false'));
        assert.ok(PAGE.includes('if (bulkRef.current || selectedIds.length === 0) return;'));
        assert.ok(PAGE.includes('bulkSending && ('));
        assert.ok(PAGE.includes('Sending Credentials'));
        assert.ok(PAGE.includes('animate-spin'));
    });

    test('BulkResultsDialog displays summary metrics (total, sent, failed, skipped) and student details', () => {
        assert.ok(PAGE.includes('const BulkResultsDialog = ({ data, onClose }) =>'));
        assert.ok(PAGE.includes('data.total') && PAGE.includes('data.sent') && PAGE.includes('data.failed') && PAGE.includes('data.skipped'));
        assert.ok(PAGE.includes('delivery to the inbox is not guaranteed'));
        assert.ok(PAGE.includes('data.results'));
        assert.ok(PAGE.includes('r.name') && PAGE.includes('r.email') && PAGE.includes('r.status') && PAGE.includes('r.message'));
    });

    test('Preserves individual Share button and does not include any notifications subsystem', () => {
        assert.ok(PAGE.includes('{canShare && ('));
        assert.ok(PAGE.includes("title={!u.is_active ? 'Activate this account to share its credentials' : u.credentials_ready ? \"E-mail this account's login details\" : 'Set a new password with Replace password first'}"));
        assert.ok(!/notification|Notification/.test(PAGE));
    });

    test('API: replacePasswordsAndShare posts user_ids list to /api/admin/users/replace-passwords-and-share/bulk', async () => {
        const { userManagementApi } = await loadModule('src/services/userManagementApi.js');
        globalThis.__axiosResponse = {
            total: 2,
            sent: 2,
            failed: 0,
            skipped: 0,
            results: [
                { id: 201, name: 'Student A', email: 'sa@example.com', status: 'sent', message: 'Password replaced and credentials sent.' },
                { id: 202, name: 'Student B', email: 'sb@example.com', status: 'sent', message: 'Password replaced and credentials sent.' },
            ],
        };

        const res = await userManagementApi.replacePasswordsAndShare([201, 202]);
        const [call] = globalThis.__axiosCalls;
        assert.equal(rel(call), 'POST /api/admin/users/replace-passwords-and-share/bulk');
        assert.deepEqual(call.body, { user_ids: [201, 202] });
        assert.ok(!('Authorization' in call.headers), 'HttpOnly session cookie is used');
        assert.equal(res.total, 2);
        assert.equal(res.sent, 2);
        assert.ok(call.timeout >= 60000, 'sufficient timeout for batch processing');
    });

    test('Replace Passwords & Share button renders in selection banner with warning confirmation dialog', () => {
        assert.ok(PAGE.includes('id="bulk-replace-and-share-btn"'));
        assert.ok(PAGE.includes('disabled={bulkSending}'));
        assert.ok(PAGE.includes('onClick={() => setBulkReplaceConfirmOpen(true)}'));
        assert.ok(PAGE.includes('isOpen={bulkReplaceConfirmOpen}'));
    });

    test('Confirmation dialog warns that existing passwords will be replaced and active sessions revoked', () => {
        assert.ok(PAGE.includes('Replace Passwords & Share Credentials?'));
        assert.ok(PAGE.includes('will be replaced') || PAGE.includes('replace passwords for'));
        assert.ok(PAGE.includes('sign them out of any active sessions'));
        assert.ok(PAGE.includes('previous passwords will no longer work'));
    });
});

