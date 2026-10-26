"""
Migration: Make organization_id nullable in all student-related tables.
Enables independent/self-registered students (whose organization_id is NULL)
to access Mock Interviews, Simulations, Projects, Practice, and Copilot without
IntegrityError (NOT NULL constraint failed: *.organization_id).
"""

import sqlite3
import shutil
import os
import sys

TARGET_TABLES = [
    "student_roadmaps",
    "student_daily_tasks",
    "student_practice_attempts",
    "student_mock_interviews",
    "student_mock_interview_turns",
    "student_projects",
    "student_placement_simulations",
    "student_placement_simulation_rounds",
    "student_copilot_messages",
    "placement_drive_applications",
]

def migrate_database(db_path: str):
    if not os.path.exists(db_path):
        print(f"[!] Database file not found: {db_path}")
        return False

    print(f"[*] Starting migration on {db_path}")
    backup_path = f"{db_path}.bak_nullable_org"
    shutil.copy2(db_path, backup_path)
    print(f"[*] Backup created at: {backup_path}")

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    try:
        cursor.execute("PRAGMA foreign_keys = OFF;")

        for table in TARGET_TABLES:
            # Check if table exists
            cursor.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name=?;", (table,))
            row = cursor.fetchone()
            if not row or not row[0]:
                print(f"[-] Table {table} not found, skipping.")
                continue

            old_sql = row[0]
            if "organization_id INTEGER NOT NULL" not in old_sql:
                print(f"[=] Table {table} already has organization_id nullable or not matched.")
                continue

            # Fetch indexes on the old table
            cursor.execute("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL;", (table,))
            indexes = cursor.fetchall()

            # Generate new table definition
            new_sql = old_sql.replace("organization_id INTEGER NOT NULL", "organization_id INTEGER")
            temp_table = f"{table}__migrating"

            # Replace table name in create sql
            create_temp_sql = new_sql.replace(f"CREATE TABLE {table}", f"CREATE TABLE {temp_table}", 1)

            cursor.execute(create_temp_sql)

            # Copy data
            cursor.execute(f"INSERT INTO {temp_table} SELECT * FROM {table};")

            # Drop old table
            cursor.execute(f"DROP TABLE {table};")

            # Rename temp table to real table
            cursor.execute(f"ALTER TABLE {temp_table} RENAME TO {table};")

            # Recreate indexes
            for idx_name, idx_sql in indexes:
                try:
                    cursor.execute(idx_sql)
                except sqlite3.OperationalError as idx_err:
                    print(f"    Notice re-creating index {idx_name}: {idx_err}")

            print(f"[+] Migrated {table} successfully to nullable organization_id.")

        conn.commit()
        cursor.execute("PRAGMA foreign_keys = ON;")
        print("[*] Migration committed successfully.")

        # Verification step
        print("\n--- VERIFICATION ---")
        for table in TARGET_TABLES:
            cursor.execute(f"PRAGMA table_info({table});")
            cols = cursor.fetchall()
            org_col = [c for c in cols if c[1] == "organization_id"]
            if org_col:
                notnull = org_col[0][3]
                status = "NULLABLE (OK)" if notnull == 0 else "STILL NOT NULL (FAIL)"
                print(f"Table {table:35s}: organization_id is {status}")

        conn.close()
        return True

    except Exception as e:
        conn.rollback()
        conn.close()
        print(f"[ERROR] Migration failed: {e}")
        print(f"[*] Restoring from backup {backup_path}")
        shutil.copy2(backup_path, db_path)
        return False

if __name__ == "__main__":
    target_db = sys.argv[1] if len(sys.argv) > 1 else "backend/PrepWin.db"
    success = migrate_database(target_db)
    sys.exit(0 if success else 1)
