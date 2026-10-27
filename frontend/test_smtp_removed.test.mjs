import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(__dirname, 'src', ...p), 'utf-8');

describe('Email delivery (SMTP) removed from the UI', () => {
    test('1. Dashboard no longer shows email status or a resend button', () => {
        const src = read('pages', 'Dashboard.jsx');
        for (const gone of ['email_sent', 'Email Sent', 'handleRetryInvitation', 'retryingInvitationId', 'Resend invitation email']) {
            assert.ok(!src.includes(gone), `Dashboard must not contain "${gone}"`);
        }
        // The former recruiter Dashboard (invitation status + "Link Ready") was replaced by the unified Overview (merge f5f54e63); links
        // are now shared from Shared Links, which has its own Copy link coverage (test_shared_link_expiry / test_assessment_invitations).
        assert.ok(src.includes('OverviewKpis'), 'the Dashboard is the unified Overview');
    });

    test('2. the retry-email API method is gone', () => {
        assert.ok(!read('services', 'rolereadyApi.js').includes('retryInvitation'));
    });

    test('3. recruiter rounds page shows login details after assigning a test', () => {
        const src = read('pages', 'RecruitmentRoundsManager.jsx');
        assert.ok(src.includes('data.credentials'));
        assert.ok(src.includes('issuedCredentials'));
        assert.ok(src.includes('Copy message'));
        assert.ok(src.includes('c.password') && src.includes('c.login_url'));
        assert.ok(!src.includes('An email with their unique test link will be sent'));
    });

    test('4. settings page has no email template tab, email alerts, recipient or weekly digest', () => {
        const src = read('pages', 'GlobalSettings.jsx');
        for (const gone of ["id: 'email'", 'Email Alerts', 'Weekly Digest', 'HR Notification Recipient Email', 'Test Invitation Email', "activeTab === 'email'"]) {
            assert.ok(!src.includes(gone), `GlobalSettings must not contain "${gone}"`);
        }
        assert.ok(src.includes("id: 'notifications'"));
    });
});
