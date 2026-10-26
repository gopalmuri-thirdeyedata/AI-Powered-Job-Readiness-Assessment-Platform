import sqlite3
import sys
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "PrepWin.db"

def main():
    print(f"Connecting to database: {DB_PATH}")
    if not DB_PATH.exists():
        print(f"ERROR: Database file {DB_PATH} not found!")
        sys.exit(1)

    conn = sqlite3.connect(str(DB_PATH))
    conn.execute("PRAGMA foreign_keys = ON;")
    cursor = conn.cursor()

    try:
        # Step 1: Verify Profile 230
        cursor.execute("SELECT id, user_id, full_name, email FROM student_profiles WHERE id = 230;")
        p230 = cursor.fetchone()
        if p230:
            print(f"Found StudentProfile 230: ID={p230[0]}, user_id={p230[1]}, name='{p230[2]}', email='{p230[3]}'")
            # Verify user_id is admin@thirdeyedata.ai
            cursor.execute("SELECT id, email, role FROM users WHERE id = ?;", (p230[1],))
            owner = cursor.fetchone()
            print(f"Profile 230 owner: {owner}")
            assert owner and owner[1].lower() == "admin@thirdeyedata.ai", "Profile 230 does not belong to admin@thirdeyedata.ai!"

            # Check every table in database for student_profile_id = 230
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
            tables = [r[0] for r in cursor.fetchall() if not r[0].startswith("sqlite_")]
            total_refs = 0
            for tbl in tables:
                cursor.execute(f"PRAGMA table_info('{tbl}');")
                cols = [c[1] for c in cursor.fetchall()]
                if "student_profile_id" in cols:
                    cursor.execute(f"SELECT COUNT(*) FROM '{tbl}' WHERE student_profile_id = 230;")
                    cnt = cursor.fetchone()[0]
                    if cnt > 0:
                        print(f"WARNING: Table '{tbl}' has {cnt} rows referencing profile 230!")
                        total_refs += cnt

            if total_refs > 0:
                raise RuntimeError(f"Cannot delete Profile 230: found {total_refs} referencing rows!")
            print("Verified: 0 foreign key references point to StudentProfile 230.")
        else:
            print("StudentProfile 230 already removed or not present.")

        # Step 2: Begin transaction
        conn.execute("BEGIN TRANSACTION;")

        # Update Gopal's role to STUDENT and ensure organization_id = 8
        cursor.execute("""
            UPDATE users
            SET role = 'STUDENT', organization_id = 8
            WHERE lower(email) = 'gopalmuri1919@gmail.com';
        """)
        print(f"Updated Gopal's role to STUDENT: {cursor.rowcount} row(s) updated.")

        # Ensure admin is ADMIN
        cursor.execute("""
            UPDATE users
            SET role = 'ADMIN', organization_id = 8
            WHERE lower(email) = 'admin@thirdeyedata.ai';
        """)
        print(f"Verified admin role is ADMIN: {cursor.rowcount} row(s) updated.")

        # Ensure Suprit is STUDENT
        cursor.execute("""
            UPDATE users
            SET role = 'STUDENT', organization_id = 8
            WHERE lower(email) = 'mundgodsuprit@gmail.com';
        """)
        print(f"Verified Suprit role is STUDENT: {cursor.rowcount} row(s) updated.")

        # Delete profile 230 if present
        if p230:
            cursor.execute("DELETE FROM student_profiles WHERE id = 230;")
            print(f"Deleted StudentProfile 230: {cursor.rowcount} row(s) deleted.")

        # Step 3: Run Integrity and Foreign Key Checks
        cursor.execute("PRAGMA foreign_key_check;")
        fk_violations = cursor.fetchall()
        if fk_violations:
            raise RuntimeError(f"Foreign key violations detected: {fk_violations}")
        print("PRAGMA foreign_key_check: 0 violations.")

        cursor.execute("PRAGMA integrity_check;")
        integrity = cursor.fetchall()
        print(f"PRAGMA integrity_check: {integrity}")
        if integrity != [("ok",)]:
            raise RuntimeError(f"Integrity check failed: {integrity}")

        conn.commit()
        print("Transaction committed successfully.")

    except Exception as e:
        conn.rollback()
        print(f"ERROR: {e}")
        sys.exit(1)
    finally:
        conn.close()

if __name__ == "__main__":
    main()
