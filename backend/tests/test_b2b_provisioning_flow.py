import os
import sys
import unittest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import models
import database
import utils
from main import app
from tests import local_auth_helpers as lh

class TestB2BProvisioningFlow(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)
        db = next(database.get_db())

        for email in ['gopalmuri2004@gmail.com', 'abc.admin@abctech.com', 'hr1@abctech.com', 'xyz.admin@xyztech.com', 'xyz.hr@xyztech.com']:
            u = db.query(models.User).filter(models.User.email == email).first()
            if u:
                db.query(models.OrganizationMember).filter(models.OrganizationMember.user_id == u.id).delete()
                db.query(models.ActivityLog).filter(models.ActivityLog.user_id == u.id).delete()
                db.query(models.Candidate).filter(models.Candidate.created_by == u.id).delete()
                db.delete(u)
        
        for slug in ['abc-technologies', 'xyz-technologies']:
            org = db.query(models.Organization).filter(models.Organization.slug == slug).first()
            if org:
                db.query(models.Candidate).filter(models.Candidate.organization_id == org.id).delete()
                db.query(models.OrganizationMember).filter(models.OrganizationMember.organization_id == org.id).delete()
                db.delete(org)
        
        # SQLite has no enforced FK cascade and reuses row ids, so memberships orphaned by earlier runs
        # can attach to newly created users and make the tenant resolve a missing organization.
        db.query(models.OrganizationMember).filter(
            ~models.OrganizationMember.organization_id.in_(db.query(models.Organization.id))
        ).delete(synchronize_session=False)

        db.commit()

        cls.plat_email = 'admin@thirdeyedata.ai'
        plat = db.query(models.User).filter(models.User.email == cls.plat_email).first()
        if not plat:
            plat = models.User(
                email=cls.plat_email,
                role=models.UserRole.SUPER_ADMIN,
                hashed_password=utils.get_password_hash(lh.TEST_PASSWORD),
                is_active=True
            )
            db.add(plat)
            db.commit()
            db.refresh(plat)
        else:
            plat.role = models.UserRole.SUPER_ADMIN
            plat.hashed_password = utils.get_password_hash(lh.TEST_PASSWORD)
            plat.is_active = True
            db.commit()
        cls.plat_id = plat.id

    @staticmethod
    def _login(email):
        c, res = lh.login(email)
        return c, {'X-CSRF-Token': res.json()['csrf_token']}, res

    def test_01_platform_admin_login_success(self):
        c, csrf, res = self._login('admin@thirdeyedata.ai')
        self.assertNotIn('access', res.json())
        self.__class__.plat_c, self.__class__.plat_csrf = c, csrf

        me_res = c.get('/api/auth/me')
        self.assertEqual(me_res.status_code, 200)
        self.assertEqual(me_res.json()['role'], 'SUPER_ADMIN')    # the platform owner is a real SUPER_ADMIN row, not an e-mail pattern

    def test_02_unprovisioned_gopalmuri2004_rejected_with_401(self):
        lh.reset_login_limits()
        res = lh.new_client().post('/api/auth/login/', json={
            'email': 'gopalmuri2004@gmail.com',
            'password': lh.TEST_PASSWORD
        })
        self.assertEqual(res.status_code, 401)
        self.assertEqual(res.json()['detail'], 'Invalid email or password.')

        db = next(database.get_db())
        user_check = db.query(models.User).filter(models.User.email == 'gopalmuri2004@gmail.com').first()
        self.assertIsNone(user_check)

    def test_03_platform_admin_creates_organization(self):
        res = self.plat_c.post(
            '/api/platform/organizations',
            headers=self.plat_csrf,
            json={
                'name': 'ABC Technologies',
                'admin_email': 'abc.admin@abctech.com',
                'admin_password': lh.TEST_PASSWORD
            }
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.__class__.abc_org_id = data['organization']['id']
        self.assertEqual(data['organization']['name'], 'ABC Technologies')
        self.assertEqual(data['organization']['credential_status'], 'password_set')
        self.assertNotIn(lh.TEST_PASSWORD, res.text)

    def test_04_org_admin_login_and_permissions(self):
        c, csrf, res = self._login('abc.admin@abctech.com')
        self.__class__.abc_admin_c, self.__class__.abc_admin_csrf = c, csrf

        me_res = c.get('/api/auth/me')
        self.assertEqual(me_res.status_code, 200)
        me_data = me_res.json()
        self.assertEqual(me_data['role'], 'ADMIN')
        self.assertEqual(me_data['organization_id'], self.abc_org_id)

        plat_res = c.get('/api/platform/organizations')
        self.assertEqual(plat_res.status_code, 403)

    def test_05_only_a_super_admin_adds_hr_admins(self):
        # An organization Admin cannot add administrators (HR/Admin) - server-side, whatever the UI shows
        for role in ('HR', 'ADMIN', 'ORGANIZATION_ADMIN'):
            res = self.abc_admin_c.post(
                '/api/organization/users/invite',
                headers=self.abc_admin_csrf,
                json={'email': 'hr1@abctech.com', 'role': role, 'password': lh.TEST_PASSWORD}
            )
            self.assertEqual(res.status_code, 403, role)
        db = next(database.get_db())
        self.assertIsNone(db.query(models.User).filter(models.User.email == 'hr1@abctech.com').first())
        # The Super Admin adds the HR admin to ABC (explicitly targeting the organization)
        res = self.plat_c.post(
            '/api/admin/users/',
            headers={**self.plat_csrf, 'X-Organization-Id': str(self.abc_org_id)},
            json={'role': 'ADMIN', 'full_name': 'HR One', 'email': 'hr1@abctech.com', 'password': lh.TEST_PASSWORD}
        )
        self.assertEqual(res.status_code, 201, res.text)
        self.assertEqual(res.json()['user']['role'], 'ADMIN')
        self.assertNotIn(lh.TEST_PASSWORD, res.text)
        db.expire_all()
        member = db.query(models.OrganizationMember).join(models.User, models.User.id == models.OrganizationMember.user_id).filter(
            models.User.email == 'hr1@abctech.com').first()
        self.assertEqual((member.role, member.organization_id), ('ADMIN', self.abc_org_id))

    def test_05b_invite_without_password_creates_a_locked_account(self):
        res = self.abc_admin_c.post(
            '/api/organization/users/invite',
            headers=self.abc_admin_csrf,
            json={'email': 'student+locked@abctech.com', 'role': 'STUDENT'}
        )
        self.assertEqual(res.status_code, 200)
        lh.reset_login_limits()
        for pw in (lh.TEST_PASSWORD, 'clerk_managed_user'):
            login = lh.new_client().post('/api/auth/login/', json={'email': 'student+locked@abctech.com', 'password': pw})
            self.assertEqual(login.status_code, 401)
        db = next(database.get_db())
        u = db.query(models.User).filter(models.User.email == 'student+locked@abctech.com').first()
        if u:
            db.query(models.OrganizationMember).filter(models.OrganizationMember.user_id == u.id).delete()
            db.query(models.StudentProfile).filter(models.StudentProfile.user_id == u.id).delete()
            db.delete(u)
            db.commit()

    def test_06_hr_user_login_and_permissions(self):
        c, csrf, res = self._login('hr1@abctech.com')
        self.__class__.abc_hr_c, self.__class__.abc_hr_csrf = c, csrf

        me_res = c.get('/api/auth/me')
        self.assertEqual(me_res.status_code, 200)
        self.assertEqual(me_res.json()['role'], 'ADMIN')
        self.assertEqual(me_res.json()['organization_id'], self.abc_org_id)

        plat_res = c.get('/api/platform/organizations')
        self.assertEqual(plat_res.status_code, 403)

    def test_07_tenant_user_list_isolation(self):
        res = self.plat_c.post(
            '/api/platform/organizations',
            headers=self.plat_csrf,
            json={'name': 'XYZ Technologies', 'admin_email': 'xyz.admin@xyztech.com', 'admin_password': lh.TEST_PASSWORD}
        )
        self.assertEqual(res.status_code, 200)

        abc_users_res = self.abc_admin_c.get('/api/organization/users')
        self.assertEqual(abc_users_res.status_code, 200)
        abc_emails = [u['email'] for u in abc_users_res.json()]
        self.assertIn('abc.admin@abctech.com', abc_emails)
        self.assertIn('hr1@abctech.com', abc_emails)
        self.assertNotIn('xyz.admin@xyztech.com', abc_emails)

        plat_org_res = self.plat_c.get(f'/api/platform/organizations/{self.abc_org_id}')
        self.assertEqual(plat_org_res.status_code, 200)
        plat_emails = [m['email'] for m in plat_org_res.json()['members']]
        self.assertIn('abc.admin@abctech.com', plat_emails)
        self.assertIn('hr1@abctech.com', plat_emails)

    def test_08_cross_tenant_candidate_data_isolation(self):
        cand_res = self.abc_hr_c.post(
            '/api/resume/candidates/',
            headers=self.abc_hr_csrf,
            json={
                'name': 'Alice Candidate',
                'email': 'alice@candidate.com',
                'role': 'Frontend Developer',
                'stage': 'Applied'
            }
        )
        self.assertEqual(cand_res.status_code, 200)
        cand_id = cand_res.json()['id']

        abc_cands = self.abc_hr_c.get('/api/resume/candidates/').json()
        self.assertTrue(any(c['id'] == cand_id for c in abc_cands))

        xyz_c, _csrf, _res = self._login('xyz.admin@xyztech.com')
        xyz_cands = xyz_c.get('/api/resume/candidates/').json()
        self.assertFalse(any(c['id'] == cand_id for c in xyz_cands))

    def test_09_account_existence_endpoints_are_gone(self):
        """The Clerk-era pre-auth e-mail probe (account enumeration) no longer exists, for any e-mail."""
        for email in ('gopalmuri2004@gmail.com', 'admin@thirdeyedata.ai', 'abc.admin@abctech.com'):
            self.assertIn(self.client.post('/api/auth/check-email/', json={'email': email}).status_code, (404, 405))
            self.assertIn(self.client.get(f'/api/auth/check-email/?email={email}').status_code, (404, 405))
