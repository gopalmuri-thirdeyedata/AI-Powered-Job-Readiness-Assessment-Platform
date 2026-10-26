"""
PrepWin Database Migration: Consolidate User Roles to Exactly Two Roles (ADMIN, STUDENT)
Idempotent and repeatable migration script with automatic safety backup and rollback capabilities.
"""
import os
import sys
import shutil
import sqlite3
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(__file__), "PrepWin.db")

def create_backup():
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_path = os.path.join(os.path.dirname(__file__), f"hiringai_backup_{timestamp}.db")
    shutil.copyfile(DB_PATH, backup_path)
    print(f"Safety backup created at: {backup_path}")
    return backup_path

def run_migration():
    if not os.path.exists(DB_PATH):
        raise FileNotFoundError(f"Database not found at {DB_PATH}")

    backup_path = create_backup()
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    try:
        print("Starting role consolidation migration...")

        # 1. Inspect baseline
        cur.execute("SELECT role, COUNT(*) FROM users GROUP BY role")
        print("Baseline users distribution:", cur.fetchall())

        cur.execute("SELECT role, COUNT(*) FROM organization_members GROUP BY role")
        print("Baseline organization_members distribution:", cur.fetchall())

        # 2. Update users table: Map all admin variants to ADMIN
        admin_roles = ('PLATFORM_ADMIN', 'ORGANIZATION_ADMIN', 'HR', 'SUPER_ADMIN', 'HR_ADMIN', 'RECRUITER', 'INTERVIEWER')
        cur.execute(f"UPDATE users SET role = 'ADMIN' WHERE role IN {admin_roles}")
        admin_users_updated = cur.rowcount
        print(f"Updated {admin_users_updated} administrative user(s) to 'ADMIN'.")

        # 3. Update users table: Map candidates and students to STUDENT
        cur.execute("UPDATE users SET role = 'STUDENT' WHERE role IN ('STUDENT', 'CANDIDATE')")
        student_users_updated = cur.rowcount
        print(f"Updated {student_users_updated} student/candidate user(s) to 'STUDENT'.")

        # 4. Update organization_members table: Map administrative memberships to ADMIN
        cur.execute(f"UPDATE organization_members SET role = 'ADMIN' WHERE role IN {admin_roles}")
        admin_members_updated = cur.rowcount
        print(f"Updated {admin_members_updated} organization member(s) to 'ADMIN'.")

        # 5. Ensure all ADMIN users with an organization_id have an organization_members record
        cur.execute("""
            INSERT INTO organization_members (organization_id, user_id, role, status, created_at, updated_at)
            SELECT u.organization_id, u.id, 'ADMIN', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            FROM users u
            WHERE u.role = 'ADMIN' 
              AND u.organization_id IS NOT NULL
              AND NOT EXISTS (
                  SELECT 1 FROM organization_members om 
                  WHERE om.user_id = u.id AND om.organization_id = u.organization_id
              )
        """)
        backfilled_members = cur.rowcount
        print(f"Backfilled {backfilled_members} missing organization membership record(s).")

        conn.commit()

        # 6. Verify final distribution
        cur.execute("SELECT role, COUNT(*) FROM users GROUP BY role")
        final_users = cur.fetchall()
        print("Final users distribution:", final_users)

        cur.execute("SELECT role, COUNT(*) FROM organization_members GROUP BY role")
        final_members = cur.fetchall()
        print("Final organization_members distribution:", final_members)

        # Ensure no unexpected roles remain
        valid_roles = {'ADMIN', 'STUDENT'}
        user_roles = {r[0] for r in final_users}
        if not user_roles.issubset(valid_roles):
            raise ValueError(f"Unexpected roles found in users table: {user_roles - valid_roles}")

        print("Migration succeeded: All users and memberships consolidated strictly into ADMIN and STUDENT.")
        return backup_path

    except Exception as e:
        conn.rollback()
        print(f"Error occurred during migration: {e}. Restoring from backup {backup_path}...")
        shutil.copyfile(backup_path, DB_PATH)
        print("Database restored to pre-migration state.")
        raise
    finally:
        conn.close()

def rollback_migration(backup_file):
    if not os.path.exists(backup_file):
        raise FileNotFoundError(f"Backup file not found: {backup_file}")
    shutil.copyfile(backup_file, DB_PATH)
    print(f"Rollback successful: {DB_PATH} restored from {backup_file}")

if __name__ == "__main__":
    run_migration()
