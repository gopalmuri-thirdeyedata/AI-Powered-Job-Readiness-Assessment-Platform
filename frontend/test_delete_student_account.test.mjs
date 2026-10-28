import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), 'utf-8');
const page = read('src', 'pages', 'admin', 'UserManagementPage.jsx');
const api = read('src', 'services', 'userManagementApi.js');
const ui = read('src', 'components', 'admin', 'adminUi.jsx');

const between = (src, from, to) => {
    const a = src.indexOf(from);
    assert.ok(a >= 0, `missing ${from}`);
    const b = src.indexOf(to, a + from.length);
    assert.ok(b > a, `missing ${to}`);
    return src.slice(a, b);
};

describe('Admin User Management: Delete student account', () => {
    test('1. the API client sends DELETE with the student e-mail as the explicit confirmation', () => {
        assert.ok(api.includes('deleteStudent: async (id, email) =>'));
        assert.ok(api.includes('axios.delete(`${BASE}/${id}`'));
        assert.ok(api.includes('params: { confirm_email: email }'));
        assert.ok(api.includes('headers: headers()'), 'the organization header travels with every admin call');
    });

    test('2. the row action is a red Delete button for student rows only, never for the signed-in admin', () => {
        const actions = between(page, 'const RowActions = (', 'const Avatar');
        assert.ok(actions.includes("canManage && !isSelf && u.role === 'STUDENT' && ("));
        assert.ok(actions.includes('className={dangerOutlineBtn}'));
        assert.ok(actions.includes('onClick={() => setDeleteTarget(u)}'));
        assert.ok(actions.includes('aria-label={`Delete ${u.email}`}'));
        assert.equal((actions.match(/aria-label=\{`Delete /g) || []).length, 1, 'exactly one Delete action per row');
        assert.ok(ui.includes('export const dangerOutlineBtn') && /dangerOutlineBtn = .*text-red-600/.test(ui), 'red at rest');
    });

    test('3. the existing row actions are unchanged (View, Share, Replace password, Activate / Deactivate)', () => {
        const actions = between(page, 'const RowActions = (', 'const Avatar');
        assert.ok(actions.includes('aria-label={`View ${u.email}`}'));
        assert.ok(actions.includes('aria-label={`Share login credentials with ${u.email}`}'));
        assert.ok(actions.includes('aria-label={`Replace password for ${u.email}`}'));
        assert.ok(actions.includes("aria-label={`${u.is_active ? 'Deactivate' : 'Activate'} ${u.email}`}"));
        assert.ok(actions.includes('<Eye size={14} />') && actions.includes('<Mail size={14} />') && actions.includes('<KeyRound size={14} />') && actions.includes('<Power size={14} />'));
        assert.equal((actions.match(/className=\{ghostBtn\}/g) || []).length, 3, 'View, Share and Replace password keep ghostBtn');
        assert.ok(actions.includes('onClick={() => setConfirm(u)}'), 'activate / deactivate still use their confirmation');
    });

    test('4. the table and the card layout both render the same actions with the delete handler wired in', () => {
        assert.equal((page.match(/setDeleteTarget=\{setDeleteTarget\}/g) || []).length, 2);
        assert.ok(page.includes('const [deleteTarget, setDeleteTarget] = useState(null);'));
        assert.ok(page.includes('{deleteTarget && ('));
        assert.ok(page.includes('<DeleteAccountDialog user={deleteTarget}'));
    });

    test('5. the confirmation dialog names the student, explains the permanent removal and needs an explicit acknowledgement', () => {
        const dialog = between(page, 'const DeleteAccountDialog = (', 'Details / edit');
        assert.ok(dialog.includes('title="Delete student account?"'));
        assert.ok(dialog.includes('{name}') && dialog.includes('{user.email}'), 'name and e-mail are shown');
        assert.ok(dialog.includes('permanently delete the account'));
        assert.ok(dialog.includes('may be permanently removed'));
        assert.ok(dialog.includes('cannot be undone'));
        assert.ok(dialog.includes('Administrative audit records are kept'));
        assert.ok(dialog.includes('id="delete-account-understood"') && dialog.includes('type="checkbox"'));
        assert.ok(dialog.includes('disabled={!understood || busy}'), 'the red button stays disabled until the box is ticked');
        assert.ok(dialog.includes('className={dangerBtn}'));
        assert.ok(dialog.includes('Delete permanently'));
        assert.ok(!dialog.includes('autoFocus'), 'Enter must never confirm a deletion by accident');
    });

    test('6. repeated clicks cannot send duplicate requests and the dialog cannot be dismissed mid-request', () => {
        const dialog = between(page, 'const DeleteAccountDialog = (', 'Details / edit');
        assert.ok(dialog.includes('const inFlight = useRef(false);'));
        assert.ok(dialog.includes('if (!understood || inFlight.current) return;'));
        assert.ok(dialog.includes('inFlight.current = true;'));
        assert.ok(dialog.includes('const close = () => { if (!inFlight.current) onClose(); };'));
        assert.ok(dialog.includes('<Dialog title="Delete student account?" onClose={close}>'), 'Escape and the backdrop use the guarded close');
        assert.equal((dialog.match(/deleteStudent\(/g) || []).length, 1);
        assert.ok(dialog.includes('onSubmit={submit}'));
    });

    test('7. success refreshes the list (and steps back a page when the last row of a page went), failures are shown in the dialog', () => {
        const handler = between(page, 'const accountDeleted = (res) => {', 'Assessment Access: flips');
        assert.ok(handler.includes('setDeleteTarget(null)'));
        assert.ok(handler.includes('setSelectedIds((prev) => prev.filter((id) => id !== target?.id))'));
        assert.ok(handler.includes('say(res.message)'));
        assert.ok(handler.includes('if (page > 1 && data.items.length === 1) setPage((p) => p - 1); else load();'));
        const dialog = between(page, 'const DeleteAccountDialog = (', 'Details / edit');
        assert.ok(dialog.includes('<FormError>{error}</FormError>'));
        assert.ok(dialog.includes('onFailed()'), 'an already-deleted account refreshes the list behind the dialog');
    });

    test('8. the other User Management features are still wired', () => {
        for (const needle of ['userManagementApi.deactivate(', 'userManagementApi.activate(', 'userManagementApi.setAssessmentAccess(', 'userManagementApi.shareCredentials(',
            'userManagementApi.bulkShareCredentials(', 'userManagementApi.replacePasswordsAndShare(', '<CreateUserDialog', '<ResetPasswordDialog', '<DetailsDialog']) {
            assert.ok(page.includes(needle), needle);
        }
        for (const method of ['create:', 'update:', 'deactivate:', 'activate:', 'setAssessmentAccess:', 'resetPassword:', 'shareCredentials:', 'bulkShareCredentials:', 'replacePasswordsAndShare:']) {
            assert.ok(api.includes(method), method);
        }
    });
});
