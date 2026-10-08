import os
import sys
import unittest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import models
import database
import utils
from main import app

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
        
        db.commit()

        cls.plat_email = 'gopalmuri1919@gmail.com'
        plat = db.query(models.User).filter(models.User.email == cls.plat_email).first()
        if not plat:
            plat = models.User(
                email=cls.plat_email,
                role=models.UserRole.PLATFORM_ADMIN,
                hashed_password=utils.get_password_hash('test_plat_pw'),
                is_active=True
            )
            db.add(plat)
            db.commit()
            db.refresh(plat)
        else:
            plat.role = models.UserRole.PLATFORM_ADMIN
            db.commit()
        cls.plat_id = plat.id

    def test_01_platform_admin_login_success(self):
        res = self.client.post('/api/auth/clerk-sync/', json={
            'email': 'gopalmuri1919@gmail.com',
            'clerk_user_id': 'clerk_plat_1919'
        })
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn('access', data)
        self.__class__.plat_token = data['access']

        me_res = self.client.get('/api/auth/me', headers={'Authorization': f'Bearer {self.plat_token}'})
        self.assertEqual(me_res.status_code, 200)
        self.assertEqual(me_res.json()['role'], 'PLATFORM_ADMIN')

    def test_02_unprovisioned_gopalmuri2004_rejected_with_403(self):
        res = self.client.post('/api/auth/clerk-sync/', json={
            'email': 'gopalmuri2004@gmail.com',
            'clerk_user_id': 'clerk_uninvited_2004'
        })
        self.assertEqual(res.status_code, 403)
        self.assertIn('not been invited', res.json()['detail'].lower())

        db = next(database.get_db())
        user_check = db.query(models.User).filter(models.User.email == 'gopalmuri2004@gmail.com').first()
        self.assertIsNone(user_check)

    def test_03_platform_admin_creates_organization(self):
        res = self.client.post(
            '/api/platform/organizations',
            headers={'Authorization': f'Bearer {self.plat_token}'},
            json={
                'name': 'ABC Technologies',
                'admin_email': 'abc.admin@abctech.com'
            }
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.__class__.abc_org_id = data['organization']['id']
        self.assertEqual(data['organization']['name'], 'ABC Technologies')

    def test_04_org_admin_login_and_permissions(self):
        res = self.client.post('/api/auth/clerk-sync/', json={
            'email': 'abc.admin@abctech.com',
            'clerk_user_id': 'clerk_abc_admin'
        })
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.__class__.abc_admin_token = data['access']

        me_res = self.client.get('/api/auth/me', headers={'Authorization': f'Bearer {self.abc_admin_token}'})
        self.assertEqual(me_res.status_code, 200)
        me_data = me_res.json()
        self.assertEqual(me_data['role'], 'ORGANIZATION_ADMIN')
        self.assertEqual(me_data['organization_id'], self.abc_org_id)

        plat_res = self.client.get('/api/platform/organizations', headers={'Authorization': f'Bearer {self.abc_admin_token}'})
        self.assertEqual(plat_res.status_code, 403)

    def test_05_org_admin_invites_hr(self):
        res = self.client.post(
            '/api/organization/users/invite',
            headers={'Authorization': f'Bearer {self.abc_admin_token}'},
            json={'email': 'hr1@abctech.com', 'role': 'HR'}
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()['member']['role'], 'HR')

    def test_06_hr_user_login_and_permissions(self):
        res = self.client.post('/api/auth/clerk-sync/', json={
            'email': 'hr1@abctech.com',
            'clerk_user_id': 'clerk_hr1_abc'
        })
        self.assertEqual(res.status_code, 200)
        self.__class__.abc_hr_token = res.json()['access']

        me_res = self.client.get('/api/auth/me', headers={'Authorization': f'Bearer {self.abc_hr_token}'})
        self.assertEqual(me_res.status_code, 200)
        self.assertEqual(me_res.json()['role'], 'HR')
        self.assertEqual(me_res.json()['organization_id'], self.abc_org_id)

        invite_res = self.client.post(
            '/api/organization/users/invite',
            headers={'Authorization': f'Bearer {self.abc_hr_token}'},
            json={'email': 'hr2@abctech.com', 'role': 'HR'}
        )
        self.assertEqual(invite_res.status_code, 403)

        plat_res = self.client.get('/api/platform/organizations', headers={'Authorization': f'Bearer {self.abc_hr_token}'})
        self.assertEqual(plat_res.status_code, 403)

    def test_07_tenant_user_list_isolation(self):
        res = self.client.post(
            '/api/platform/organizations',
            headers={'Authorization': f'Bearer {self.plat_token}'},
            json={'name': 'XYZ Technologies', 'admin_email': 'xyz.admin@xyztech.com'}
        )
        self.assertEqual(res.status_code, 200)

        abc_users_res = self.client.get('/api/organization/users', headers={'Authorization': f'Bearer {self.abc_admin_token}'})
        self.assertEqual(abc_users_res.status_code, 200)
        abc_emails = [u['email'] for u in abc_users_res.json()]
        self.assertIn('abc.admin@abctech.com', abc_emails)
        self.assertIn('hr1@abctech.com', abc_emails)
        self.assertNotIn('xyz.admin@xyztech.com', abc_emails)

        plat_org_res = self.client.get(f'/api/platform/organizations/{self.abc_org_id}', headers={'Authorization': f'Bearer {self.plat_token}'})
        self.assertEqual(plat_org_res.status_code, 200)
        plat_emails = [m['email'] for m in plat_org_res.json()['members']]
        self.assertIn('abc.admin@abctech.com', plat_emails)
        self.assertIn('hr1@abctech.com', plat_emails)

    def test_08_cross_tenant_candidate_data_isolation(self):
        cand_res = self.client.post(
            '/api/resume/candidates/',
            headers={'Authorization': f'Bearer {self.abc_hr_token}'},
            json={
                'name': 'Alice Candidate',
                'email': 'alice@candidate.com',
                'role': 'Frontend Developer',
                'stage': 'Applied'
            }
        )
        self.assertEqual(cand_res.status_code, 200)
        cand_id = cand_res.json()['id']

        abc_cands = self.client.get('/api/resume/candidates/', headers={'Authorization': f'Bearer {self.abc_hr_token}'}).json()
        self.assertTrue(any(c['id'] == cand_id for c in abc_cands))

        xyz_sync = self.client.post('/api/auth/clerk-sync/', json={'email': 'xyz.admin@xyztech.com', 'clerk_user_id': 'clerk_xyz_admin'})
        self.assertEqual(xyz_sync.status_code, 200)
        xyz_token = xyz_sync.json()['access']

        xyz_cands = self.client.get('/api/resume/candidates/', headers={'Authorization': f'Bearer {xyz_token}'}).json()
        self.assertFalse(any(c['id'] == cand_id for c in xyz_cands))

    def test_09_check_email_pre_auth_unregistered(self):
        # Unregistered gopalmuri2004@gmail.com must be rejected BEFORE OTP is sent
        res = self.client.post('/api/auth/check-email/', json={'email': 'gopalmuri2004@gmail.com'})
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertFalse(data['allowed'])
        self.assertIn('not been invited', data['detail'])

        # GET method should also return allowed: False
        get_res = self.client.get('/api/auth/check-email/?email=gopalmuri2004@gmail.com')
        self.assertEqual(get_res.status_code, 200)
        self.assertFalse(get_res.json()['allowed'])

    def test_10_check_email_pre_auth_registered_users(self):
        # Platform Admin
        plat_res = self.client.post('/api/auth/check-email/', json={'email': 'gopalmuri1919@gmail.com'})
        self.assertEqual(plat_res.status_code, 200)
        self.assertTrue(plat_res.json()['allowed'])
        self.assertEqual(plat_res.json()['role'], 'PLATFORM_ADMIN')

        # Provisioned Org Admin
        admin_res = self.client.post('/api/auth/check-email/', json={'email': 'abc.admin@abctech.com'})
        self.assertEqual(admin_res.status_code, 200)
        self.assertTrue(admin_res.json()['allowed'])
        self.assertEqual(admin_res.json()['role'], 'ORGANIZATION_ADMIN')

        # Provisioned HR
        hr_res = self.client.post('/api/auth/check-email/', json={'email': 'hr1@abctech.com'})
        self.assertEqual(hr_res.status_code, 200)
        self.assertTrue(hr_res.json()['allowed'])
        self.assertEqual(hr_res.json()['role'], 'HR')

