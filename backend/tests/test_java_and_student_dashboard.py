import pytest
from fastapi.testclient import TestClient
from main import app
import models
from services import roleready_service, judge0_service
from tests.test_roleready_pipeline import db_session, setup_test_data

client = TestClient(app)

def test_java_starter_and_language_support():
    # 1. Verify Java starter code structure
    starter = roleready_service.JAVA_STARTER_DEFAULT
    assert "public class Main" in starter
    assert "public static void main(String[] args)" in starter
    assert "Scanner" in starter

    # 2. Verify language validation
    assert roleready_service._require_supported_language("java") == "java"
    assert roleready_service._require_supported_language("python") == "python"
    assert roleready_service._require_supported_language("python3") == "python"

    with pytest.raises(Exception):
        roleready_service._require_supported_language("ruby")

    # 3. Verify Judge0 language ID mapping
    assert judge0_service.LANGUAGE_MAP["java"]["language_id"] == 62
    assert judge0_service.LANGUAGE_MAP["python"]["language_id"] == 71


def test_student_assessments_endpoint_and_isolation(db_session, setup_test_data):
    # Setup candidate A
    student_a = setup_test_data["student_profile"]
    headers_a = setup_test_data["auth_headers"]

    # Initialize a session for student A
    session_a = roleready_service.create_student_session(
        db=db_session,
        student_profile=student_a,
        target_role="Full Stack Engineer",
        target_company="ThirdEye Data",
        custom_jd_text="Looking for Java and Python Full Stack Developer."
    )

    # Call endpoint for student A
    res = client.get("/api/roleready/student/assessments", headers=headers_a)
    assert res.status_code == 200
    data = res.json()

    assert data["student_id"] == student_a.id
    assert data["total_attempted"] >= 1
    assert data["active_session"] is not None
    assert data["active_session"]["session_uuid"] == session_a.session_uuid
    assert data["active_session"]["continue_url"] == f"/assessment/{session_a.session_uuid}"
    assert len(data["assessments"]) >= 1

    first_rec = data["assessments"][0]
    assert first_rec["target_role"] == "Full Stack Engineer"
    assert first_rec["is_completed"] is False
    assert first_rec["continue_url"] == f"/assessment/{session_a.session_uuid}"
    assert first_rec["report_url"] is None
