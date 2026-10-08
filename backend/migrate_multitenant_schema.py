"""
HiringAI B2B Multi-Tenant Database Migration Script
Idempotent schema migration creating organizations and organization_members tables,
adding tenant foreign keys to business tables, and backfilling existing data.
"""
import sys
import os
import sqlalchemy as sa
from sqlalchemy.sql import text
from database import engine

def run_migration():
    print("--- Starting HiringAI Multi-Tenant Schema Migration ---")
    inspector = sa.inspect(engine)
    existing_tables = set(inspector.get_table_names())

    with engine.begin() as conn:
        # 1. Create organizations table if not exists
        if "organizations" not in existing_tables:
            print("Creating 'organizations' table...")
            conn.execute(text("""
                CREATE TABLE organizations (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    name VARCHAR(150) NOT NULL,
                    slug VARCHAR(150) NOT NULL UNIQUE,
                    clerk_org_id VARCHAR(150) NULL UNIQUE,
                    status VARCHAR(50) NOT NULL DEFAULT 'active',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    INDEX idx_org_slug (slug),
                    INDEX idx_org_clerk (clerk_org_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            """))
        else:
            print("Table 'organizations' already exists.")

        # 2. Create organization_members table if not exists
        if "organization_members" not in existing_tables:
            print("Creating 'organization_members' table...")
            conn.execute(text("""
                CREATE TABLE organization_members (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    organization_id INT NOT NULL,
                    user_id INT NOT NULL,
                    clerk_user_id VARCHAR(150) NULL,
                    role VARCHAR(50) NOT NULL DEFAULT 'HR',
                    status VARCHAR(50) NOT NULL DEFAULT 'active',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    INDEX idx_mem_org (organization_id),
                    INDEX idx_mem_user (user_id),
                    INDEX idx_mem_clerk (clerk_user_id),
                    CONSTRAINT fk_mem_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
                    CONSTRAINT fk_mem_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            """))
        else:
            print("Table 'organization_members' already exists.")

        # 3. Add columns to existing tables
        columns_to_add = [
            ("users", "organization_id", "INT NULL"),
            ("users", "clerk_user_id", "VARCHAR(150) NULL"),
            ("candidates", "organization_id", "INT NULL"),
            ("job_descriptions", "organization_id", "INT NULL"),
            ("assessments", "organization_id", "INT NULL"),
            ("global_settings", "organization_id", "INT NULL"),
            ("activity_logs", "organization_id", "INT NULL"),
            ("notifications", "organization_id", "INT NULL"),
        ]

        # Re-inspect columns
        for table, col, col_def in columns_to_add:
            if table in existing_tables:
                current_cols = {c['name'] for c in inspector.get_columns(table)}
                if col not in current_cols:
                    print(f"Adding column '{col}' to table '{table}'...")
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {col_def};"))
                    # Add index on organization_id
                    if col == "organization_id":
                        try:
                            conn.execute(text(f"ALTER TABLE {table} ADD INDEX idx_{table}_org (organization_id);"))
                        except Exception as e:
                            print(f"Note: index creation: {e}")
                else:
                    print(f"Column '{col}' already exists in table '{table}'. Skipping.")

        # 4. Safe Backfill / Seed Default Organization
        org_count = conn.execute(text("SELECT COUNT(*) FROM organizations")).scalar()
        if org_count == 0:
            print("Seeding default 'Primary Organization'...")
            conn.execute(text("""
                INSERT INTO organizations (id, name, slug, status)
                VALUES (1, 'Primary Organization', 'primary', 'active')
            """))

        # Update Platform Admin role for owner
        platform_admin_email = os.getenv("PLATFORM_ADMIN_EMAIL", "gopalmuri1919@gmail.com").strip().lower()
        conn.execute(text("""
            UPDATE users SET role = 'PLATFORM_ADMIN'
            WHERE LOWER(email) = :admin_email OR LOWER(email) = 'admin@hiringai.com'
        """), {"admin_email": platform_admin_email})

        # Backfill organization_id for existing legacy recruiter users
        conn.execute(text("""
            UPDATE users SET organization_id = 1
            WHERE organization_id IS NULL AND NOT email LIKE '%.internal' AND role != 'PLATFORM_ADMIN'
        """))

        # Backfill organization_id for existing candidates, job_descriptions, assessments, settings
        conn.execute(text("UPDATE candidates SET organization_id = 1 WHERE organization_id IS NULL;"))
        conn.execute(text("UPDATE job_descriptions SET organization_id = 1 WHERE organization_id IS NULL;"))
        conn.execute(text("UPDATE assessments SET organization_id = 1 WHERE organization_id IS NULL;"))
        conn.execute(text("UPDATE global_settings SET organization_id = 1 WHERE organization_id IS NULL;"))
        conn.execute(text("UPDATE activity_logs SET organization_id = 1 WHERE organization_id IS NULL;"))
        conn.execute(text("UPDATE notifications SET organization_id = 1 WHERE organization_id IS NULL;"))

        # Ensure members exist in organization_members for recruiters in org 1
        conn.execute(text("""
            INSERT IGNORE INTO organization_members (organization_id, user_id, role, status)
            SELECT organization_id, id, 'ORGANIZATION_ADMIN', 'active'
            FROM users
            WHERE organization_id = 1 AND NOT email LIKE '%.internal' AND role != 'PLATFORM_ADMIN'
            AND id NOT IN (SELECT user_id FROM organization_members WHERE organization_id = 1)
        """))

    print("--- HiringAI Multi-Tenant Schema Migration Completed Successfully! ---")

if __name__ == "__main__":
    try:
        run_migration()
    except Exception as e:
        print(f"Migration error: {e}", file=sys.stderr)
        sys.exit(1)
