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


class TestGoogleAuthAuthorization(unittest.TestCase):
    """
    Dedicated Security Regression Test Suite:
    Verifies that Google OAuth / Email OTP authentication alone NEVER grants
    Platform Admin, Organization Admin, HR, or Portal access without an explicit,
    server-side provisioned membership in the database.
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
            status="active",
            clerk_org_id="clerk_org_comp_a"
        )
        db.add(cls.org_a)

        # Create Company B
        cls.org_b = models.Organization(
            name="Company B Ltd",
            slug="company-b-ltd",
            status="active",
            clerk_org_id="clerk_org_comp_b"
        )
        db.add(cls.org_b)
        db.commit()
        db.refresh(cls.org_a)
        db.refresh(cls.org_b)
        cls.org_a_id = cls.org_a.id
        cls.org_b_id = cls.org_b.id

        # 1. Platform Admin user
        cls.platform_admin_email = "test_platform_admin@testtenant.com"
        cls.platform_admin_clerk_id = "clerk_test_plat_admin_123"
        cls.plat_admin = models.User(
            email=cls.platform_admin_email,
            role=models.UserRole.PLATFORM_ADMIN,
            hashed_password=utils.get_password_hash("test_pass"),
            is_active=True,
            clerk_user_id=cls.platform_admin_clerk_id
        )
        db.add(cls.plat_admin)

        # 2. Company A Org Admin
        cls.org_a_admin_email = "admin@companya.com"
        cls.org_a_admin_clerk_id = "clerk_test_admin_a_google"
        cls.admin_a = models.User(
            email=cls.org_a_admin_email,
            role=models.UserRole.ORGANIZATION_ADMIN,
            hashed_password=utils.get_password_hash("test_pass"),
            is_active=True,
            organization_id=cls.org_a_id,
            clerk_user_id=cls.org_a_admin_clerk_id
        )
        db.add(cls.admin_a)
        db.commit()
        db.refresh(cls.admin_a)

        db.add(models.OrganizationMember(
            organization_id=cls.org_a_id,
            user_id=cls.admin_a.id,
            clerk_user_id=cls.org_a_admin_clerk_id,
            role="ORGANIZATION_ADMIN",
            status="active"
        ))

        # 3. Company A HR (explicitly provisioned)
        cls.hr_a_email = "hr1@companya.com"
        cls.hr_a_clerk_id = "clerk_test_hr1_a_google"
        cls.hr_a = models.User(
            email=cls.hr_a_email,
            role=models.UserRole.HR,
            hashed_password=utils.get_password_hash("test_pass"),
            is_active=True,
            organization_id=cls.org_a_id,
            clerk_user_id=cls.hr_a_clerk_id
        )
        db.add(cls.hr_a)
        db.commit()
        db.refresh(cls.hr_a)

        db.add(models.OrganizationMember(
            organization_id=cls.org_a_id,
            user_id=cls.hr_a.id,
            clerk_user_id=cls.hr_a_clerk_id,
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
        os.environ["PLATFORM_ADMIN_CLERK_USER_ID"] = cls.platform_admin_clerk_id

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
        db.query(models.OrganizationMember).filter(models.OrganizationMember.clerk_user_id.like("clerk_test_%")).delete(synchronize_session=False)
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
        os.environ["PLATFORM_ADMIN_EMAIL"] = "gopalmuri1919@gmail.com"
        os.environ["PLATFORM_ADMIN_CLERK_USER_ID"] = ""

    def test_01_unknown_google_user_rejected_with_403(self):
        """
        TEST 1: Unknown Google user
        Input: clerk_user_id = unknown_google_user, no organization membership.
        Expected: HTTP 403 Forbidden. No role, no organization, no db records created.
        """
        res = self.client.post("/api/auth/clerk-sync/", json={
            "email": "arbitrary_google_user@gmail.com",
            "clerk_user_id": "unknown_google_user_99999"
        })
        self.assertEqual(res.status_code, 403)
        self.assertTrue(any(t in res.json()["detail"].lower() for t in ("not been invited", "not been provisioned")))

        # Verify no user or membership created
        db = next(database.get_db())
        user_in_db = db.query(models.User).filter(models.User.email == "arbitrary_google_user@gmail.com").first()
        member_in_db = db.query(models.OrganizationMember).filter(models.OrganizationMember.clerk_user_id == "unknown_google_user_99999").first()
        db.close()
        self.assertIsNone(user_in_db, "Uninvited Google user must NOT be inserted into users table")
        self.assertIsNone(member_in_db, "Uninvited Google user must NOT be inserted into organization_members")

    def test_02_unknown_gmail_user_rejected_with_403(self):
        """
        TEST 2: Unknown Gmail user
        Input: random@gmail.com, no HiringAI membership.
        Expected: HTTP 403 Forbidden.
        """
        res = self.client.post("/api/auth/clerk-sync/", json={
            "email": "random@gmail.com",
            "clerk_user_id": "clerk_random_gmail_user"
        })
        self.assertEqual(res.status_code, 403)
        self.assertTrue(any(t in res.json()["detail"].lower() for t in ("not been invited", "not been provisioned")))

    def test_03_valid_platform_admin_authorized(self):
        """
        TEST 3: Valid Platform Admin
        Explicit platform-admin record.
        Expected: HTTP 200, role = PLATFORM_ADMIN.
        """
        res = self.client.post("/api/auth/clerk-sync/", json={
            "email": self.platform_admin_email,
            "clerk_user_id": self.platform_admin_clerk_id
        })
        self.assertEqual(res.status_code, 200)
        token = res.json()["access"]

        # Call /api/auth/me
        me_res = self.client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(me_res.status_code, 200)
        me_data = me_res.json()
        self.assertEqual(me_data["role"], "PLATFORM_ADMIN")
        self.assertIsNone(me_data["organization_id"])

        # Call platform-only API -> Allowed
        plat_res = self.client.get("/api/platform/organizations", headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(plat_res.status_code, 200)

    def test_04_valid_organization_admin_authorized(self):
        """
        TEST 4: Valid Organization Admin
        Explicit organization membership in Company A.
        Expected: HTTP 200, role = ORGANIZATION_ADMIN, organization_id = Company A.
        """
        res = self.client.post("/api/auth/clerk-sync/", json={
            "email": self.org_a_admin_email,
            "clerk_user_id": self.org_a_admin_clerk_id
        })
        self.assertEqual(res.status_code, 200)
        token = res.json()["access"]

        # Call /api/auth/me
        me_res = self.client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(me_res.status_code, 200)
        me_data = me_res.json()
        self.assertEqual(me_data["role"], "ORGANIZATION_ADMIN")
        self.assertEqual(me_data["organization_id"], self.org_a_id)
        self.assertEqual(me_data["organization_name"], "Company A Corp")

        # MUST NOT be able to access platform-only API
        plat_res = self.client.get("/api/platform/organizations", headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(plat_res.status_code, 403, "Org Admin must NOT have platform admin access")

    def test_05_valid_hr_authorized(self):
        """
        TEST 5: Valid HR
        Explicit organization membership in Company A as HR.
        Expected: HTTP 200, role = HR, organization_id = Company A.
        """
        res = self.client.post("/api/auth/clerk-sync/", json={
            "email": self.hr_a_email,
            "clerk_user_id": self.hr_a_clerk_id
        })
        self.assertEqual(res.status_code, 200)
        token = res.json()["access"]

        # Call /api/auth/me
        me_res = self.client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(me_res.status_code, 200)
        me_data = me_res.json()
        self.assertEqual(me_data["role"], "HR")
        self.assertEqual(me_data["organization_id"], self.org_a_id)

        # MUST NOT be able to access platform-only API
        plat_res = self.client.get("/api/platform/organizations", headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(plat_res.status_code, 403, "HR must NOT have platform admin access")

    def test_06_uninvited_google_user_from_company_domain_rejected(self):
        """
        TEST 6: Google user with matching company domain (uninvited.employee@companya.com)
        Google authentication succeeds in Clerk, but user has NO HiringAI membership.
        Expected: HTTP 403 Forbidden. Matching email domain alone does NOT grant access.
        """
        res = self.client.post("/api/auth/clerk-sync/", json={
            "email": "uninvited.employee@companya.com",
            "clerk_user_id": "clerk_uninvited_emp_google"
        })
        self.assertEqual(res.status_code, 403)
        self.assertTrue(any(t in res.json()["detail"].lower() for t in ("not been invited", "not been provisioned")))

    def test_07_company_a_hr_accesses_company_a_data_only(self):
        """
        TEST 7: Company A HR with explicit membership
        Expected: Can access Company A candidates; sees Alice Alpha.
        """
        sync_res = self.client.post("/api/auth/clerk-sync/", json={
            "email": self.hr_a_email,
            "clerk_user_id": self.hr_a_clerk_id
        })
        token = sync_res.json()["access"]

        cand_res = self.client.get("/api/resume/candidates/", headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(cand_res.status_code, 200)
        cand_list = cand_res.json()

        cand_names = [c["name"] for c in cand_list]
        self.assertIn("Alice Alpha", cand_names, "HR from Company A should see Alice Alpha")
        self.assertNotIn("Bob Beta", cand_names, "HR from Company A must NOT see Bob Beta from Company B")

    def test_08_company_a_hr_cannot_access_or_mutate_company_b(self):
        """
        TEST 8: Company A HR attempts to access or mutate Company B candidate
        Expected: HTTP 404/403. Cross-tenant access and mutation is blocked.
        """
        sync_res = self.client.post("/api/auth/clerk-sync/", json={
            "email": self.hr_a_email,
            "clerk_user_id": self.hr_a_clerk_id
        })
        token = sync_res.json()["access"]

        # 1. Update Company B candidate via PATCH -> 404 Not Found
        update_res = self.client.patch(
            f"/api/resume/candidates/{self.cand_b_id}/",
            json={"stage": "Technical Interview"},
            headers={"Authorization": f"Bearer {token}"}
        )
        self.assertEqual(update_res.status_code, 404, "Cross-tenant candidate update must return 404")

        # 2. Delete Company B candidate via DELETE -> 404 Not Found
        del_res = self.client.delete(f"/api/resume/candidates/{self.cand_b_id}/", headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(del_res.status_code, 404, "Cross-tenant candidate delete must return 404")

        # 3. Access Company B candidate resume file -> 404 Not Found
        file_res = self.client.get(f"/api/resume/file/{self.cand_b_id}", headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(file_res.status_code, 404, "Cross-tenant file access must return 404")


if __name__ == "__main__":
    unittest.main()
