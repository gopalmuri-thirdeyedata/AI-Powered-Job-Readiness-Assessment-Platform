import os
import sys
import unittest
from datetime import datetime, timezone, timedelta
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import models
import database
from main import app
from routers.auth import get_current_user


class TestAnalyticsDashboard(unittest.TestCase):
    """
    Tests for the Recruitment Intelligence Dashboard analytics API.
    """

    def setUp(self):
        self.client = TestClient(app)
        self.recruiter = models.User(
            id=999,
            email="analytics_recruiter@example.com",
            role=models.UserRole.HR_ADMIN,
            organization_id=9999
        )
        app.dependency_overrides[get_current_user] = lambda: self.recruiter

        # Clean any test candidate records for user 999 and tenant 9999
        db = next(database.get_db())
        try:
            db.query(models.Candidate).filter(
                (models.Candidate.created_by == 999) | (models.Candidate.organization_id == 9999)
            ).delete()
            db.commit()
        finally:
            db.close()

    def tearDown(self):
        db = next(database.get_db())
        try:
            db.query(models.Candidate).filter(
                (models.Candidate.created_by == 999) | (models.Candidate.organization_id == 9999)
            ).delete()
            db.commit()
        finally:
            db.close()
        app.dependency_overrides.clear()

    def test_01_empty_dataset_returns_valid_zero_structure(self):
        """1. When no candidates exist, analytics returns a clean valid structure without errors."""
        res = self.client.get("/api/dashboard/analytics/")
        self.assertEqual(res.status_code, 200)
        data = res.json()

        self.assertIn("kpi", data)
        self.assertEqual(data["kpi"]["total_applicants"], 0)
        self.assertEqual(data["kpi"]["active_pipeline"], 0)
        self.assertEqual(data["kpi"]["avg_talent_score"], 0.0)
        self.assertEqual(data["kpi"]["placement_rate"], 0.0)
        self.assertEqual(data["kpi"]["pipeline_health_score"], 0.0)

        self.assertIn("funnel", data)
        self.assertIn("ai_recommendations", data)
        self.assertIn("round_performance", data)
        self.assertIn("role_insights", data)
        self.assertIn("bottlenecks", data)
        self.assertIn("skills_intelligence", data)
        self.assertIn("attention_items", data)

    def test_02_populated_dataset_computes_accurate_metrics(self):
        """2. Validates accurate KPI, funnel, role, and score calculations on real candidate records."""
        db = next(database.get_db())
        try:
            now = datetime.now(timezone.utc)
            c1 = models.Candidate(
                name="Alice Developer",
                email="alice@test.com",
                role="Full Stack Developer",
                stage=models.CandidateStage.Resume_Screening.value,
                status=models.CandidateStatus.Applied.value,
                score=85.0,
                analysis_data={"skills": ["Python", "React", "PostgreSQL"]},
                created_by=999,
                organization_id=9999,
                created_at=now
            )
            c2 = models.Candidate(
                name="Bob Engineer",
                email="bob@test.com",
                role="Full Stack Developer",
                stage=models.CandidateStage.Aptitude_Round.value,
                status="Submitted: 8/10",
                score=90.0,
                analysis_data={
                    "skills": ["Python", "FastAPI"],
                    "score_percentage": 80.0,
                    "correct": 8,
                    "total": 10
                },
                created_by=999,
                organization_id=9999,
                created_at=now
            )
            c3 = models.Candidate(
                name="Charlie Coder",
                email="charlie@test.com",
                role="Backend Developer",
                stage=models.CandidateStage.Coding_Round.value,
                status=models.CandidateStatus.In_Progress.value,
                score=0.0,
                analysis_data={"skills": ["Java", "Docker"]},
                created_by=999,
                organization_id=9999,
                created_at=now - timedelta(days=5)
            )
            c4 = models.Candidate(
                name="Diana Hired",
                email="diana@test.com",
                role="Backend Developer",
                stage="Hired",
                status="Hired",
                score=95.0,
                analysis_data={"skills": ["Python", "Docker", "AWS"]},
                created_by=999,
                organization_id=9999,
                created_at=now - timedelta(days=2)
            )
            db.add_all([c1, c2, c3, c4])
            db.commit()
        finally:
            db.close()

        res = self.client.get("/api/dashboard/analytics/")
        self.assertEqual(res.status_code, 200)
        data = res.json()

        kpi = data["kpi"]
        self.assertEqual(kpi["total_applicants"], 4)
        # Active pipeline (in screening/aptitude/coding): c1, c2, c3 = 3
        self.assertEqual(kpi["active_pipeline"], 3)
        # Placement rate: 1 hired out of 4 = 25%
        self.assertEqual(kpi["placement_rate"], 25.0)

        # Role insights should have 2 distinct roles
        roles = {r["role"]: r for r in data["role_insights"]}
        self.assertIn("Full Stack Developer", roles)
        self.assertIn("Backend Developer", roles)
        self.assertEqual(roles["Full Stack Developer"]["total_applicants"], 2)
        self.assertEqual(roles["Backend Developer"]["total_applicants"], 2)

        # Skills intelligence should aggregate skills
        skill_counts = {s["skill"]: s["candidate_count"] for s in data["skills_intelligence"]}
        self.assertIn("Python", skill_counts)
        self.assertEqual(skill_counts["Python"], 3) # Alice, Bob, Diana

        # Attention items should flag Charlie (unscored / score 0)
        attention_names = [a["name"] for a in data["attention_items"]]
        self.assertIn("Charlie Coder", attention_names)

    def test_03_role_and_date_filtering(self):
        """3. Tests filtering by specific role and date range."""
        db = next(database.get_db())
        try:
            now = datetime.now(timezone.utc)
            c1 = models.Candidate(
                name="Role A Cand",
                email="role_a@test.com",
                role="Frontend Developer",
                stage=models.CandidateStage.Resume_Screening.value,
                score=70.0,
                created_by=999,
                organization_id=9999,
                created_at=now
            )
            c2 = models.Candidate(
                name="Role B Old Cand",
                email="role_b_old@test.com",
                role="DevOps Engineer",
                stage=models.CandidateStage.Resume_Screening.value,
                score=60.0,
                created_by=999,
                organization_id=9999,
                created_at=now - timedelta(days=40)
            )
            db.add_all([c1, c2])
            db.commit()
        finally:
            db.close()

        # Test role filter
        res_role = self.client.get("/api/dashboard/analytics/?role=Frontend Developer")
        self.assertEqual(res_role.status_code, 200)
        data_role = res_role.json()
        self.assertEqual(data_role["kpi"]["total_applicants"], 1)

        # Test date filter (days=7 should exclude 40-day old candidate)
        res_date = self.client.get("/api/dashboard/analytics/?days=7")
        self.assertEqual(res_date.status_code, 200)
        data_date = res_date.json()
        self.assertEqual(data_date["kpi"]["total_applicants"], 1)


if __name__ == "__main__":
    unittest.main()
