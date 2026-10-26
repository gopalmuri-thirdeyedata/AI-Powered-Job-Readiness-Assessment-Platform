import sqlite3
import sys
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "PrepWin.db"

def main():
    conn = sqlite3.connect(str(DB_PATH))
    cursor = conn.cursor()

    # 1. Check user accounts
    cursor.execute("SELECT id, email, role, organization_id, is_active FROM users ORDER BY id;")
    users = cursor.fetchall()
    print(f"Total User Accounts: {len(users)}")
    for u in users:
        print(f"  ID={u[0]} | Email={u[1]} | Role={u[2]} | OrgID={u[3]} | Active={u[4]}")

    admin_count = sum(1 for u in users if u[2] == "ADMIN")
    student_count = sum(1 for u in users if u[2] == "STUDENT")
    both_roles = sum(1 for u in users if u[2] not in ("ADMIN", "STUDENT"))

    print("\nAccount Counts Summary:")
    print(f"  Total user accounts: {len(users)} (Expected: 3)")
    print(f"  ADMIN accounts: {admin_count} (Expected: 1)")
    print(f"  STUDENT accounts: {student_count} (Expected: 2)")
    print(f"  Accounts with abnormal/both roles: {both_roles} (Expected: 0)")

    assert len(users) == 3, f"Expected 3 users, got {len(users)}"
    assert admin_count == 1, f"Expected 1 admin, got {admin_count}"
    assert student_count == 2, f"Expected 2 students, got {student_count}"
    assert both_roles == 0, f"Expected 0 abnormal roles, got {both_roles}"

    # 2. Check student profiles
    cursor.execute("SELECT id, user_id, full_name, email, organization_id FROM student_profiles ORDER BY id;")
    profiles = cursor.fetchall()
    print(f"\nTotal Student Profiles: {len(profiles)} (Expected: 2)")
    for p in profiles:
        print(f"  Profile ID={p[0]} | UserID={p[1]} | Name='{p[2]}' | Email='{p[3]}' | OrgID={p[4]}")

    profile_emails = [p[3].lower() for p in profiles]
    assert "admin@thirdeyedata.ai" not in profile_emails, "Admin still has a student profile!"
    assert "gopalmuri1919@gmail.com" in profile_emails, "Gopal missing student profile!"
    assert "mundgodsuprit@gmail.com" in profile_emails, "Suprit missing student profile!"
    assert len(profiles) == 2, f"Expected 2 student profiles, got {len(profiles)}"

    # 3. Check assessment sessions for Suprit
    cursor.execute("""
        SELECT s.id, s.session_uuid, s.workflow_type, s.current_state, s.overall_readiness_score
        FROM roleready_sessions s
        JOIN student_profiles p ON s.student_profile_id = p.id
        WHERE lower(p.email) = 'mundgodsuprit@gmail.com';
    """)
    sessions = cursor.fetchall()
    print(f"\nAssessment Sessions for mundgodsuprit@gmail.com: {len(sessions)} (Expected: 3)")
    for s in sessions:
        print(f"  Session ID={s[0]} | UUID={s[1]} | Workflow={s[2]} | State={s[3]} | Score={s[4]}")
    assert len(sessions) == 3, f"Expected 3 sessions for Suprit, got {len(sessions)}"

    # 4. Check PRAGMAs
    cursor.execute("PRAGMA foreign_key_check;")
    fk_violations = cursor.fetchall()
    assert not fk_violations, f"FK violations: {fk_violations}"
    print("\nPRAGMA foreign_key_check: PASS (0 violations)")

    cursor.execute("PRAGMA integrity_check;")
    integrity = cursor.fetchall()
    assert integrity == [("ok",)], f"Integrity check failed: {integrity}"
    print("PRAGMA integrity_check: PASS (ok)")

    conn.close()
    print("\nAll database role and profile verifications PASSED!")

if __name__ == "__main__":
    main()
