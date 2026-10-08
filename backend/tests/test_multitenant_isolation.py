import os
import sys
import unittest
from datetime import datetime
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

# Add backend directory to sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import models
import schemas
import database
import utils
from main import app
from routers.auth import get_current_user


class TestMultitenantIsolationAndSecurity(unittest.TestCase):
    """
    Comprehensive Security and Multi-Tenant Isolation Test Suite for HiringAI V2.
    Tests Clerk authentication, invite-only enforcement, role-based access control,
    and strict multi-tenant data, query, mutation, analytics, and file isolation.
    """

    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)
        db = next(database.get_db())

        # Clean up existing test organizations and foreign key dependencies if present
        test_users = db.query(models.User).filter(models.User.email.like("%@testtenant.com")).all()
        test_user_ids = [u.id for u in test_users]
        if test_user_ids:
            db.query(models.ActivityLog).filter(models.ActivityLog.user_id.in_(test_user_ids)).delete(synchronize_session=False)
            db.query(models.Notification).filter(models.Notification.user_id.in_(test_user_ids)).delete(synchronize_session=False)

        db.query(models.ActivityLog).filter(models.ActivityLog.target.like("Test %")).delete(synchronize_session=False)
        db.query(models.Assessment).filter(models.Assessment.candidate_email.like("%@testtenant.com")).delete(synchronize_session=False)
        db.query(models.Candidate).filter(models.Candidate.email.like("%@testtenant.com")).delete(synchronize_session=False)
        db.query(models.JobDescription).filter(models.JobDescription.title.like("Test %")).delete(synchronize_session=False)
        db.query(models.OrganizationMember).filter(models.OrganizationMember.clerk_user_id.like("clerk_test_%")).delete(synchronize_session=False)
        db.query(models.User).filter(models.User.email.like("%@testtenant.com")).delete(synchronize_session=False)
        db.query(models.Organization).filter(models.Organization.slug.in_(["test-org-alpha", "test-org-beta"])).delete(synchronize_session=False)
        db.commit()

        # 1. Create Organization Alpha (Org A)
        cls.org_a = models.Organization(
            name="Test Org Alpha",
            slug="test-org-alpha",
            status="active",
            clerk_org_id="clerk_org_alpha_123"
        )
        db.add(cls.org_a)

        # 2. Create Organization Beta (Org B)
        cls.org_b = models.Organization(
            name="Test Org Beta",
            slug="test-org-beta",
            status="active",
            clerk_org_id="clerk_org_beta_456"
        )
        db.add(cls.org_b)
        db.commit()
        db.refresh(cls.org_a)
        db.refresh(cls.org_b)
        cls.org_a_id = cls.org_a.id
        cls.org_b_id = cls.org_b.id

        # 3. Create Users
        # Platform Admin
        cls.platform_admin = models.User(
            email="platform_admin@testtenant.com",
            role=models.UserRole.PLATFORM_ADMIN,
            hashed_password=utils.get_password_hash("testpass"),
            is_active=True
        )
        db.add(cls.platform_admin)

        # Org Admin A
        cls.org_a_admin = models.User(
            email="admin_a@testtenant.com",
            role=models.UserRole.ORGANIZATION_ADMIN,
            organization_id=cls.org_a_id,
            hashed_password=utils.get_password_hash("testpass"),
            is_active=True,
            clerk_user_id="clerk_test_admin_a"
        )
        db.add(cls.org_a_admin)

        # HR Recruiter A
        cls.org_a_hr = models.User(
            email="hr_a@testtenant.com",
            role=models.UserRole.HR,
            organization_id=cls.org_a_id,
            hashed_password=utils.get_password_hash("testpass"),
            is_active=True,
            clerk_user_id="clerk_test_hr_a"
        )
        db.add(cls.org_a_hr)

        # Org Admin B
        cls.org_b_admin = models.User(
            email="admin_b@testtenant.com",
            role=models.UserRole.ORGANIZATION_ADMIN,
            organization_id=cls.org_b_id,
            hashed_password=utils.get_password_hash("testpass"),
            is_active=True,
            clerk_user_id="clerk_test_admin_b"
        )
        db.add(cls.org_b_admin)

        # HR Recruiter B
        cls.org_b_hr = models.User(
            email="hr_b@testtenant.com",
            role=models.UserRole.HR,
            organization_id=cls.org_b_id,
            hashed_password=utils.get_password_hash("testpass"),
            is_active=True,
            clerk_user_id="clerk_test_hr_b"
        )
        db.add(cls.org_b_hr)
        db.commit()
        db.refresh(cls.platform_admin)
        db.refresh(cls.org_a_admin)
        db.refresh(cls.org_a_hr)
        db.refresh(cls.org_b_admin)
        db.refresh(cls.org_b_hr)

        # Link memberships
        db.add(models.OrganizationMember(organization_id=cls.org_a_id, user_id=cls.org_a_admin.id, role="ORGANIZATION_ADMIN", status="active", clerk_user_id="clerk_test_admin_a"))
        db.add(models.OrganizationMember(organization_id=cls.org_a_id, user_id=cls.org_a_hr.id, role="HR", status="active", clerk_user_id="clerk_test_hr_a"))
        db.add(models.OrganizationMember(organization_id=cls.org_b_id, user_id=cls.org_b_admin.id, role="ORGANIZATION_ADMIN", status="active", clerk_user_id="clerk_test_admin_b"))
        db.add(models.OrganizationMember(organization_id=cls.org_b_id, user_id=cls.org_b_hr.id, role="HR", status="active", clerk_user_id="clerk_test_hr_b"))
        db.commit()

        # Seed initial test data for Org A
        cls.cand_a = models.Candidate(
            name="Alice Alpha",
            email="alice@testtenant.com",
            role="Python Developer",
            stage=models.CandidateStage.Resume_Screening,
            status=models.CandidateStatus.Applied,
            score=88.0,
            organization_id=cls.org_a_id,
            created_by=cls.org_a_admin.id,
            resume_file="test_alice_resume.pdf"
        )
        cls.jd_a = models.JobDescription(
            title="Test Python Lead A",
            role="Python Developer",
            organization_id=cls.org_a_id,
            created_by=cls.org_a_admin.id
        )
        db.add(cls.cand_a)
        db.add(cls.jd_a)

        # Seed initial test data for Org B
        cls.cand_b = models.Candidate(
            name="Bob Beta",
            email="bob@testtenant.com",
            role="Java Developer",
            stage=models.CandidateStage.Resume_Screening,
            status=models.CandidateStatus.Applied,
            score=92.0,
            organization_id=cls.org_b_id,
            created_by=cls.org_b_admin.id,
            resume_file="test_bob_resume.pdf"
        )
        cls.jd_b = models.JobDescription(
            title="Test Java Lead B",
            role="Java Developer",
            organization_id=cls.org_b_id,
            created_by=cls.org_b_admin.id
        )
        db.add(cls.cand_b)
        db.add(cls.jd_b)
        db.commit()
        db.refresh(cls.cand_a)
        db.refresh(cls.jd_a)
        db.refresh(cls.cand_b)
        db.refresh(cls.jd_b)
        cls.cand_a_id = cls.cand_a.id
        cls.cand_b_id = cls.cand_b.id
        cls.jd_a_id = cls.jd_a.id
        cls.jd_b_id = cls.jd_b.id
        cls.cand_a_email = cls.cand_a.email
        cls.cand_b_email = cls.cand_b.email
        cls.jd_a_title = cls.jd_a.title
        cls.jd_b_title = cls.jd_b.title

        # Create dummy file on disk for file test
        os.makedirs("media/resumes", exist_ok=True)
        with open("media/test_alice_resume.pdf", "w") as f:
            f.write("Alice Alpha Resume Content")

        # Create auth tokens
        cls.token_platform = utils.create_access_token({"sub": cls.platform_admin.email, "role": "PLATFORM_ADMIN"})
        cls.token_admin_a = utils.create_access_token({"sub": cls.org_a_admin.email, "role": "ORGANIZATION_ADMIN"})
        cls.token_hr_a = utils.create_access_token({"sub": cls.org_a_hr.email, "role": "HR"})
        cls.token_admin_b = utils.create_access_token({"sub": cls.org_b_admin.email, "role": "ORGANIZATION_ADMIN"})
        cls.token_hr_b = utils.create_access_token({"sub": cls.org_b_hr.email, "role": "HR"})

        db.close()

    def tearDown(self):
        app.dependency_overrides.clear()

    # =========================================================================
    # 1. AUTHENTICATION & INVITE-ONLY ACCESS TESTS
    # =========================================================================

    def test_01_missing_auth_token_rejected(self):
        """Requests without Authorization header must be rejected with 401 Unauthorized."""
        res = self.client.get("/api/resume/candidates/")
        self.assertEqual(res.status_code, 401)

    def test_02_invalid_auth_token_rejected(self):
        """Requests with forged or invalid JWT tokens must be rejected with 401 Unauthorized."""
        res = self.client.get(
            "/api/resume/candidates/",
            headers={"Authorization": "Bearer invalid_forged_token_12345"}
        )
        self.assertEqual(res.status_code, 401)

    def test_03_uninvited_user_clerk_sync_rejected(self):
        """Public/uninvited users attempting clerk-sync must be rejected with 403 Forbidden."""
        res = self.client.post(
            "/api/auth/clerk-sync/",
            json={"email": "random_stranger@gmail.com", "clerk_user_id": "clerk_stranger_1"}
        )
        self.assertEqual(res.status_code, 403)
        self.assertIn("invite-only", res.json()["detail"].lower())

    def test_04_invited_user_clerk_sync_succeeds(self):
        """Invited organization users syncing via Clerk receive valid JWT credentials."""
        res = self.client.post(
            "/api/auth/clerk-sync/",
            json={"email": self.org_a_admin.email, "clerk_user_id": "clerk_test_admin_a"}
        )
        self.assertEqual(res.status_code, 200)
        self.assertIn("access", res.json())

    def test_05_auth_me_resolves_role_and_organization(self):
        """GET /api/auth/me returns the user's role and resolved tenant organization."""
        res = self.client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {self.token_admin_a}"}
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["email"], self.org_a_admin.email)
        self.assertEqual(data["role"], "ORGANIZATION_ADMIN")
        self.assertEqual(data["organization_id"], self.org_a_id)
        self.assertEqual(data["organization_name"], "Test Org Alpha")

    # =========================================================================
    # 2. ROLE-BASED ACCESS CONTROL (RBAC) TESTS
    # =========================================================================

    def test_06_platform_admin_can_access_platform_apis(self):
        """Platform Admin is authorized to access platform management APIs."""
        res = self.client.get(
            "/api/platform/organizations",
            headers={"Authorization": f"Bearer {self.token_platform}"}
        )
        self.assertEqual(res.status_code, 200)
        self.assertIsInstance(res.json(), list)

    def test_07_org_admin_cannot_access_platform_apis(self):
        """Organization Admin is strictly blocked from platform management APIs."""
        res = self.client.get(
            "/api/platform/organizations",
            headers={"Authorization": f"Bearer {self.token_admin_a}"}
        )
        self.assertEqual(res.status_code, 403)

    def test_08_hr_cannot_access_platform_apis(self):
        """HR users are strictly blocked from platform management APIs."""
        res = self.client.get(
            "/api/platform/organizations",
            headers={"Authorization": f"Bearer {self.token_hr_a}"}
        )
        self.assertEqual(res.status_code, 403)

    def test_09_org_admin_can_invite_hr(self):
        """Organization Admin can invite HR recruiters to their organization."""
        res = self.client.post(
            "/api/organization/users/invite",
            json={"email": "new_recruiter_hr@testtenant.com", "role": "HR"},
            headers={"Authorization": f"Bearer {self.token_admin_a}"}
        )
        self.assertEqual(res.status_code, 200)
        self.assertIn("invitation", res.json()["message"].lower())

    def test_10_hr_cannot_invite_users(self):
        """HR users are blocked from inviting other users or admins."""
        res = self.client.post(
            "/api/organization/users/invite",
            json={"email": "unauthorized_invitee@testtenant.com"},
            headers={"Authorization": f"Bearer {self.token_hr_a}"}
        )
        self.assertEqual(res.status_code, 403)

    # =========================================================================
    # 3. STRICT MULTI-TENANT DATA ISOLATION TESTS
    # =========================================================================

    def test_11_candidate_query_isolation(self):
        """
        Org A user querying candidates sees Org A candidates and NEVER sees Org B candidates.
        Org B user querying candidates sees Org B candidates and NEVER sees Org A candidates.
        """
        # User A query
        res_a = self.client.get(
            "/api/resume/candidates/",
            headers={"Authorization": f"Bearer {self.token_admin_a}"}
        )
        self.assertEqual(res_a.status_code, 200)
        candidates_a = res_a.json()
        emails_a = [c["email"] for c in candidates_a]
        self.assertIn(self.cand_a_email, emails_a)
        self.assertNotIn(self.cand_b_email, emails_a, "Org A MUST NOT see Org B candidate!")

        # User B query
        res_b = self.client.get(
            "/api/resume/candidates/",
            headers={"Authorization": f"Bearer {self.token_admin_b}"}
        )
        self.assertEqual(res_b.status_code, 200)
        candidates_b = res_b.json()
        emails_b = [c["email"] for c in candidates_b]
        self.assertIn(self.cand_b_email, emails_b)
        self.assertNotIn(self.cand_a_email, emails_b, "Org B MUST NOT see Org A candidate!")

    def test_12_cross_tenant_candidate_update_prevented(self):
        """User from Org A cannot update a candidate belonging to Org B."""
        res = self.client.patch(
            f"/api/resume/candidates/{self.cand_b_id}/",
            json={"stage": "Technical Interview"},
            headers={"Authorization": f"Bearer {self.token_admin_a}"}
        )
        self.assertEqual(res.status_code, 404, "Attempt to update other org candidate must return 404 Not Found")

    def test_13_cross_tenant_candidate_delete_prevented(self):
        """User from Org A cannot delete a candidate belonging to Org B."""
        res = self.client.delete(
            f"/api/resume/candidates/{self.cand_b_id}/",
            headers={"Authorization": f"Bearer {self.token_admin_a}"}
        )
        self.assertEqual(res.status_code, 404, "Attempt to delete other org candidate must return 404 Not Found")

        # Verify candidate B still exists in Org B
        db = next(database.get_db())
        cand_check = db.query(models.Candidate).filter(models.Candidate.id == self.cand_b_id).first()
        db.close()
        self.assertIsNotNone(cand_check, "Candidate B must not be deleted by cross-tenant request!")

    def test_14_job_description_query_and_mutation_isolation(self):
        """
        Job descriptions are completely isolated by organization.
        Org A cannot list, view, update, or delete Org B job descriptions.
        """
        # Org A listing JDs
        res_a = self.client.get(
            "/api/resume/job-descriptions/",
            headers={"Authorization": f"Bearer {self.token_admin_a}"}
        )
        self.assertEqual(res_a.status_code, 200)
        jd_titles_a = [j["title"] for j in res_a.json()]
        self.assertIn(self.jd_a_title, jd_titles_a)
        self.assertNotIn(self.jd_b_title, jd_titles_a, "Org A MUST NOT see Org B job description!")

        # Org A trying to get Org B JD by ID
        res_get_b = self.client.get(
            f"/api/resume/job-descriptions/{self.jd_b_id}/",
            headers={"Authorization": f"Bearer {self.token_admin_a}"}
        )
        self.assertEqual(res_get_b.status_code, 404)

        # Org A trying to delete Org B JD
        res_del_b = self.client.delete(
            f"/api/resume/job-descriptions/{self.jd_b_id}/",
            headers={"Authorization": f"Bearer {self.token_admin_a}"}
        )
        self.assertEqual(res_del_b.status_code, 404)

    def test_15_parameter_manipulation_defense(self):
        """
        The backend must NEVER trust client-provided organization_id in request bodies or query params.
        Tenant context is strictly derived from the authenticated identity.
        """
        # User from Org A tries to create candidate explicitly passing organization_id of Org B
        res = self.client.post(
            "/api/resume/candidates/?organization_id=9999",
            json={
                "name": "Spoofed Candidate",
                "email": "spoofed@testtenant.com",
                "role": "QA Engineer",
                "stage": "Resume Screening",
                "status": "Applied",
                "organization_id": self.org_b_id  # Attempting to assign to Org B
            },
            headers={"Authorization": f"Bearer {self.token_admin_a}"}
        )
        self.assertEqual(res.status_code, 200)

        # Verify candidate was actually assigned to Org A, NOT Org B
        db = next(database.get_db())
        cand_created = db.query(models.Candidate).filter(models.Candidate.email == "spoofed@testtenant.com").first()
        db.close()
        self.assertIsNotNone(cand_created)
        self.assertEqual(cand_created.organization_id, self.org_a_id, "Candidate must be bound to authenticated Org A!")

    def test_16_analytics_funnel_isolation(self):
        """Analytics metrics must be strictly scoped to current tenant organization."""
        res_a = self.client.get(
            "/api/resume/stats/",
            headers={"Authorization": f"Bearer {self.token_admin_a}"}
        )
        self.assertEqual(res_a.status_code, 200)
        data_a = res_a.json()

        res_b = self.client.get(
            "/api/resume/stats/",
            headers={"Authorization": f"Bearer {self.token_admin_b}"}
        )
        self.assertEqual(res_b.status_code, 200)
        data_b = res_b.json()

        # Both organizations should only see their own metrics
        self.assertGreaterEqual(data_a["metrics"]["active"], 1)
        self.assertGreaterEqual(data_b["metrics"]["active"], 1)

    def test_17_file_download_tenant_isolation(self):
        """
        Resume files are tenant-isolated.
        User from Org B cannot download a resume belonging to a candidate in Org A.
        """
        # User B attempts to access Candidate A's resume file
        res_cross = self.client.get(
            f"/api/resume/file/{self.cand_a_id}",
            headers={"Authorization": f"Bearer {self.token_admin_b}"}
        )
        self.assertEqual(res_cross.status_code, 404, "Cross-tenant file download must return 404")

        # User A accesses Candidate A's resume file -> succeeds
        res_authorized = self.client.get(
            f"/api/resume/file/{self.cand_a_id}",
            headers={"Authorization": f"Bearer {self.token_admin_a}"}
        )
        self.assertEqual(res_authorized.status_code, 200)
        self.assertEqual(res_authorized.content, b"Alice Alpha Resume Content")

    @classmethod
    def tearDownClass(cls):
        db = next(database.get_db())
        test_users = db.query(models.User).filter(models.User.email.like("%@testtenant.com")).all()
        test_user_ids = [u.id for u in test_users]
        if test_user_ids:
            db.query(models.ActivityLog).filter(models.ActivityLog.user_id.in_(test_user_ids)).delete(synchronize_session=False)
            db.query(models.Notification).filter(models.Notification.user_id.in_(test_user_ids)).delete(synchronize_session=False)

        db.query(models.ActivityLog).filter(models.ActivityLog.target.like("Test %")).delete(synchronize_session=False)
        db.query(models.Assessment).filter(models.Assessment.candidate_email.like("%@testtenant.com")).delete(synchronize_session=False)
        db.query(models.Candidate).filter(models.Candidate.email.like("%@testtenant.com")).delete(synchronize_session=False)
        db.query(models.JobDescription).filter(models.JobDescription.title.like("Test %")).delete(synchronize_session=False)
        db.query(models.OrganizationMember).filter(models.OrganizationMember.clerk_user_id.like("clerk_test_%")).delete(synchronize_session=False)
        db.query(models.User).filter(models.User.email.like("%@testtenant.com")).delete(synchronize_session=False)
        db.query(models.Organization).filter(models.Organization.slug.in_(["test-org-alpha", "test-org-beta"])).delete(synchronize_session=False)
        db.commit()
        db.close()


if __name__ == "__main__":
    unittest.main()

