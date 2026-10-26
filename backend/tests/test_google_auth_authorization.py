import os
import sys
import unittest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

# Add backend directory to sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import models
import schemas
import database
import utils
from main import app
from tests import local_auth_helpers as lh


class TestGoogleAuthAuthorization(unittest.TestCase):
    """
    Dedicated Security Regression Test Suite:
    Verifies that only an explicitly provisioned account (admin-created, local password) ever
    obtains Platform Admin, Organization Admin, HR, or Portal access: an unknown e-mail (even one
    from a company domain) is rejected, and tenant boundaries hold for provisioned users.
    """

    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)
        db = next(database.get_db())

        # Cleanup any lingering test records
        cls._cleanup_db(db)

        # Create Company A
        cls.org_a = models.Organization(
            name="Company A Corp",
            slug="company-a-corp",
            status="active"
        )
        db.add(cls.org_a)

        # Create Company B
        cls.org_b = models.Organization(
            name="Company B Ltd",
            slug="company-b-ltd",
            status="active"
        )
        db.add(cls.org_b)
        db.commit()
        db.refresh(cls.org_a)
        db.refresh(cls.org_b)
        cls.org_a_id = cls.org_a.id
        cls.org_b_id = cls.org_b.id

        # 1. Platform Admin user
        cls.platform_admin_email = "test_platform_admin@testtenant.com"
        cls.plat_admin = models.User(
            email=cls.platform_admin_email,
            role=models.UserRole.PLATFORM_ADMIN,
            hashed_password=utils.get_password_hash(lh.TEST_PASSWORD),
            is_active=True
        )
        db.add(cls.plat_admin)

        # 2. Company A Org Admin
        cls.org_a_admin_email = "admin@companya.com"
        cls.admin_a = models.User(
            email=cls.org_a_admin_email,
            role=models.UserRole.ORGANIZATION_ADMIN,
            hashed_password=utils.get_password_hash(lh.TEST_PASSWORD),
            is_active=True,
            organization_id=cls.org_a_id
        )
        db.add(cls.admin_a)
        db.commit()
        db.refresh(cls.admin_a)

        db.add(models.OrganizationMember(
            organization_id=cls.org_a_id,
            user_id=cls.admin_a.id,
            role="ORGANIZATION_ADMIN",
            status="active"
        ))

        # 3. Company A HR (explicitly provisioned)
        cls.hr_a_email = "hr1@companya.com"
        cls.hr_a = models.User(
            email=cls.hr_a_email,
            role=models.UserRole.HR,
            hashed_password=utils.get_password_hash(lh.TEST_PASSWORD),
            is_active=True,
            organization_id=cls.org_a_id
        )
        db.add(cls.hr_a)
        db.commit()
        db.refresh(cls.hr_a)

        db.add(models.OrganizationMember(
            organization_id=cls.org_a_id,
            user_id=cls.hr_a.id,
            role="HR",
            status="active"
        ))

        # 4. Company B Candidate
        cls.cand_b = models.Candidate(
            name="Bob Beta",
            email="bob.beta@testtenant.com",
            role="DevOps Engineer",
            status="Applied",
            stage="Resume Screening",
            score=85.0,
            organization_id=cls.org_b_id
        )
        db.add(cls.cand_b)

        # 5. Company A Candidate
        cls.cand_a = models.Candidate(
            name="Alice Alpha",
            email="alice.alpha@testtenant.com",
            role="Frontend Developer",
            status="Applied",
            stage="Resume Screening",
            score=90.0,
            organization_id=cls.org_a_id
        )
        db.add(cls.cand_a)

        db.commit()
        db.refresh(cls.cand_a)
        db.refresh(cls.cand_b)
        cls.cand_a_id = cls.cand_a.id
        cls.cand_b_id = cls.cand_b.id
        db.close()

        # Set env variable for test platform admin
        os.environ["PLATFORM_ADMIN_EMAIL"] = cls.platform_admin_email

    @classmethod
    def _cleanup_db(cls, db: Session):
        test_users = db.query(models.User).filter(
            models.User.email.in_([
                "test_platform_admin@testtenant.com",
                "admin@companya.com",
                "hr1@companya.com",
                "random@gmail.com",
                "uninvited.employee@companya.com"
            ])
        ).all()
        test_user_ids = [u.id for u in test_users]
        if test_user_ids:
            db.query(models.ActivityLog).filter(models.ActivityLog.user_id.in_(test_user_ids)).delete(synchronize_session=False)
            db.query(models.Notification).filter(models.Notification.user_id.in_(test_user_ids)).delete(synchronize_session=False)

        db.query(models.Assessment).filter(models.Assessment.candidate_email.like("%@testtenant.com")).delete(synchronize_session=False)
        db.query(models.Candidate).filter(models.Candidate.email.like("%@testtenant.com")).delete(synchronize_session=False)
        db.query(models.JobDescription).filter(models.JobDescription.title.like("Test %")).delete(synchronize_session=False)
        if test_user_ids:
            db.query(models.OrganizationMember).filter(models.OrganizationMember.user_id.in_(test_user_ids)).delete(synchronize_session=False)
        db.query(models.User).filter(models.User.email.in_([
            "test_platform_admin@testtenant.com",
            "admin@companya.com",
            "hr1@companya.com",
            "random@gmail.com",
            "uninvited.employee@companya.com"
        ])).delete(synchronize_session=False)
        db.query(models.Organization).filter(models.Organization.slug.in_(["company-a-corp", "company-b-ltd"])).delete(synchronize_session=False)
        db.commit()

    @classmethod
    def tearDownClass(cls):
        db = next(database.get_db())
        cls._cleanup_db(db)
        db.close()
        os.environ["PLATFORM_ADMIN_EMAIL"] = "admin@thirdeyedata.ai"

    @staticmethod
    def _login(email):
        c, res = lh.login(email)
        return c, {"X-CSRF-Token": res.json()["csrf_token"]}, res

    def _assert_rejected_and_not_provisioned(self, email):
        lh.reset_login_limits()
        res = lh.new_client().post("/api/auth/login/", json={"email": email, "password": lh.TEST_PASSWORD})
        self.assertEqual(res.status_code, 401)
        self.assertEqual(res.json()["detail"], "Invalid email or password.")
        self.assertNotIn("prepwin_session", res.cookies)
        db = next(database.get_db())
        user_in_db = db.query(models.User).filter(models.User.email == email).first()
        db.close()
        self.assertIsNone(user_in_db, "An unknown e-mail must NOT be inserted into the users table")

    def test_01_unknown_user_rejected(self):
        """
        TEST 1: Unknown user: no account, no organization membership.
        Expected: HTTP 401 with the generic credentials error. No user or membership is created.
        """
        self._assert_rejected_and_not_provisioned("arbitrary_google_user@gmail.com")
        # The former token-exchange endpoint (which used to provision from an identity-provider id) is gone
        res = self.client.post("/api/auth/clerk-sync/", json={
            "email": "arbitrary_google_user@gmail.com",
            "clerk_user_id": "unknown_google_user_99999"
        })
        self.assertIn(res.status_code, (404, 405))

    def test_02_unknown_gmail_user_rejected(self):
        """TEST 2: random@gmail.com, no PrepWin account. Expected: HTTP 401."""
        self._assert_rejected_and_not_provisioned("random@gmail.com")

    def test_03_valid_platform_admin_authorized(self):
        """
        TEST 3: Valid Platform Admin
        Explicit platform-admin record. Expected: HTTP 200, role = SUPER_ADMIN, no organization anchor, platform API allowed.
        """
        c, _csrf, res = self._login(self.platform_admin_email)
        self.assertEqual(res.status_code, 200)

        me_res = c.get("/api/auth/me")
        self.assertEqual(me_res.status_code, 200)
        me_data = me_res.json()
        self.assertEqual(me_data["role"], "SUPER_ADMIN")
        self.assertIsNone(me_data["organization_id"])

        plat_res = c.get("/api/platform/organizations")
        self.assertEqual(plat_res.status_code, 200)

    def test_04_valid_organization_admin_authorized(self):
        """
        TEST 4: Valid Organization Admin
        Explicit organization membership in Company A.
        Expected: HTTP 200, role = ADMIN, organization_id = Company A.
        """
        c, _csrf, res = self._login(self.org_a_admin_email)
        self.assertEqual(res.status_code, 200)

        me_res = c.get("/api/auth/me")
        self.assertEqual(me_res.status_code, 200)
        me_data = me_res.json()
        self.assertIn(me_data["role"], ("ADMIN", "ORGANIZATION_ADMIN"))
        self.assertEqual(me_data["organization_id"], self.org_a_id)
        self.assertEqual(me_data["organization_name"], "Company A Corp")

        plat_res = c.get("/api/platform/organizations")
        self.assertEqual(plat_res.status_code, 403, "Org Admin must NOT have platform admin access")

    def test_05_valid_hr_authorized(self):
        """
        TEST 5: Valid HR
        Explicit organization membership in Company A as HR.
        Expected: HTTP 200, role = ADMIN, organization_id = Company A.
        """
        c, _csrf, res = self._login(self.hr_a_email)
        self.assertEqual(res.status_code, 200)

        me_res = c.get("/api/auth/me")
        self.assertEqual(me_res.status_code, 200)
        me_data = me_res.json()
        self.assertIn(me_data["role"], ("ADMIN", "HR"))
        self.assertEqual(me_data["organization_id"], self.org_a_id)

        plat_res = c.get("/api/platform/organizations")
        self.assertEqual(plat_res.status_code, 403, "HR must NOT have platform admin access")

    def test_06_uninvited_company_domain_user_rejected(self):
        """
        TEST 6: A user with a matching company domain (uninvited.employee@companya.com) but NO PrepWin account.
        Expected: HTTP 401. A matching e-mail domain alone does NOT grant access.
        """
        self._assert_rejected_and_not_provisioned("uninvited.employee@companya.com")

    def test_07_company_a_hr_accesses_company_a_data_only(self):
        """
        TEST 7: Company A HR with explicit membership
        Expected: Can access Company A candidates; sees Alice Alpha.
        """
        c, _csrf, _res = self._login(self.hr_a_email)

        cand_res = c.get("/api/resume/candidates/")
        self.assertEqual(cand_res.status_code, 200)
        cand_list = cand_res.json()

        cand_names = [x["name"] for x in cand_list]
        self.assertIn("Alice Alpha", cand_names, "HR from Company A should see Alice Alpha")
        self.assertNotIn("Bob Beta", cand_names, "HR from Company A must NOT see Bob Beta from Company B")

    def test_08_company_a_hr_cannot_access_or_mutate_company_b(self):
        """
        TEST 8: Company A HR attempts to access or mutate Company B candidate
        Expected: HTTP 404/403. Cross-tenant access and mutation is blocked.
        """
        c, csrf, _res = self._login(self.hr_a_email)

        # 1. Update Company B candidate via PATCH -> 404 Not Found
        update_res = c.patch(
            f"/api/resume/candidates/{self.cand_b_id}/",
            json={"stage": "Technical Interview"},
            headers=csrf
        )
        self.assertEqual(update_res.status_code, 404, "Cross-tenant candidate update must return 404")

        # 2. Delete Company B candidate via DELETE -> 404 Not Found
        del_res = c.delete(f"/api/resume/candidates/{self.cand_b_id}/", headers=csrf)
        self.assertEqual(del_res.status_code, 404, "Cross-tenant candidate delete must return 404")

        # 3. Access Company B candidate resume file -> 404 Not Found
        file_res = c.get(f"/api/resume/file/{self.cand_b_id}")
        self.assertEqual(file_res.status_code, 404, "Cross-tenant file access must return 404")


if __name__ == "__main__":
    unittest.main()
