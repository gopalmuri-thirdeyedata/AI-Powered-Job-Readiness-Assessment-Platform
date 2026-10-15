"""
Idempotent migration script for RoleReady — AI-Powered Job Readiness & Assessment Platform.
Provisions `recruitment_batches`, `candidate_invitations`, `roleready_sessions`, and `roleready_round_attempts`.
"""
import os
import sys
from sqlalchemy import inspect, text
from dotenv import load_dotenv

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
load_dotenv()

import database

def migrate_roleready_schema():
    print("=" * 60)
    print("MIGRATING ROLEREADY PLATFORM SCHEMA (PHASE 1)")
    print("=" * 60)

    engine = database.engine

    with engine.connect() as conn:
        # 1. Create recruitment_batches table
        print("1. Creating recruitment_batches table if not exists...")
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS recruitment_batches (
                id INT AUTO_INCREMENT PRIMARY KEY,
                organization_id INT NOT NULL,
                job_description_id INT NULL,
                batch_name VARCHAR(200) NOT NULL,
                description TEXT NULL,
                total_candidates INT NOT NULL DEFAULT 0,
                created_by INT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_rec_batch_org (organization_id),
                INDEX idx_rec_batch_jd (job_description_id),
                CONSTRAINT fk_rec_batch_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
                CONSTRAINT fk_rec_batch_jd FOREIGN KEY (job_description_id) REFERENCES job_descriptions(id) ON DELETE SET NULL,
                CONSTRAINT fk_rec_batch_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        """))

        # 2. Create candidate_invitations table
        print("2. Creating candidate_invitations table if not exists...")
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS candidate_invitations (
                id INT AUTO_INCREMENT PRIMARY KEY,
                organization_id INT NOT NULL,
                job_description_id INT NULL,
                candidate_id INT NOT NULL,
                batch_id INT NULL,
                invitation_token VARCHAR(128) NOT NULL UNIQUE,
                status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
                expires_at DATETIME NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                accepted_at DATETIME NULL,
                INDEX idx_cand_inv_org (organization_id),
                INDEX idx_cand_inv_cand (candidate_id),
                INDEX idx_cand_inv_token (invitation_token),
                INDEX idx_cand_inv_batch (batch_id),
                CONSTRAINT fk_cand_inv_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
                CONSTRAINT fk_cand_inv_cand FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE,
                CONSTRAINT fk_cand_inv_jd FOREIGN KEY (job_description_id) REFERENCES job_descriptions(id) ON DELETE SET NULL,
                CONSTRAINT fk_cand_inv_batch FOREIGN KEY (batch_id) REFERENCES recruitment_batches(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        """))

        # 3. Create roleready_sessions table
        print("3. Creating roleready_sessions table if not exists...")
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS roleready_sessions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                session_uuid VARCHAR(64) NOT NULL UNIQUE,
                workflow_type VARCHAR(30) NOT NULL DEFAULT 'SELF_ASSESSMENT',
                organization_id INT NULL,
                student_profile_id INT NULL,
                candidate_id INT NULL,
                invitation_id INT NULL,
                job_description_id INT NULL,
                target_role VARCHAR(200) NOT NULL DEFAULT 'Software Engineer',
                target_company VARCHAR(200) NULL,
                jd_title VARCHAR(255) NULL,
                custom_jd_text MEDIUMTEXT NULL,
                extracted_jd_data JSON NULL,
                resume_snapshot JSON NULL,
                resume_file_path VARCHAR(255) NULL,
                current_state VARCHAR(50) NOT NULL DEFAULT 'NOT_STARTED',
                aptitude_score FLOAT NOT NULL DEFAULT 0.0,
                coding_score FLOAT NOT NULL DEFAULT 0.0,
                interview_score FLOAT NOT NULL DEFAULT 0.0,
                overall_readiness_score FLOAT NOT NULL DEFAULT 0.0,
                final_report_data JSON NULL,
                started_at DATETIME NULL,
                completed_at DATETIME NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_rr_sess_uuid (session_uuid),
                INDEX idx_rr_sess_org (organization_id),
                INDEX idx_rr_sess_student (student_profile_id),
                INDEX idx_rr_sess_cand (candidate_id),
                INDEX idx_rr_sess_inv (invitation_id),
                CONSTRAINT fk_rr_sess_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
                CONSTRAINT fk_rr_sess_student FOREIGN KEY (student_profile_id) REFERENCES student_profiles(id) ON DELETE CASCADE,
                CONSTRAINT fk_rr_sess_cand FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE,
                CONSTRAINT fk_rr_sess_inv FOREIGN KEY (invitation_id) REFERENCES candidate_invitations(id) ON DELETE SET NULL,
                CONSTRAINT fk_rr_sess_jd FOREIGN KEY (job_description_id) REFERENCES job_descriptions(id) ON DELETE SET NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        """))

        # 4. Create roleready_round_attempts table
        print("4. Creating roleready_round_attempts table if not exists...")
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS roleready_round_attempts (
                id INT AUTO_INCREMENT PRIMARY KEY,
                session_id INT NOT NULL,
                round_type VARCHAR(30) NOT NULL,
                round_order INT NOT NULL DEFAULT 1,
                status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
                score FLOAT NOT NULL DEFAULT 0.0,
                time_limit_minutes INT NOT NULL DEFAULT 30,
                time_spent_seconds INT NOT NULL DEFAULT 0,
                questions_payload JSON NULL,
                server_keys_payload JSON NULL,
                submission_payload JSON NULL,
                evaluation_payload JSON NULL,
                proctoring_violations JSON NULL,
                started_at DATETIME NULL,
                submitted_at DATETIME NULL,
                evaluated_at DATETIME NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_rr_round_sess (session_id),
                INDEX idx_rr_round_type (round_type),
                CONSTRAINT fk_rr_round_sess FOREIGN KEY (session_id) REFERENCES roleready_sessions(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        """))

        conn.commit()
        print("SUCCESS: RoleReady schema successfully migrated!")

# Additive, nullable columns only (never dropped on rollback — see implementation plan, Section 7).
# (column, DDL for SQLite, DDL for MySQL). MySQL needs MEDIUMTEXT: extracted resume text can exceed TEXT's 64 KB.
ADDITIVE_COLUMNS = {
    "roleready_sessions": [("resume_raw_text", "TEXT NULL", "MEDIUMTEXT NULL")],
}


def apply_additive_columns(engine=None) -> list:
    """
    Idempotently adds new nullable columns to existing tables on SQLite or MySQL.
    Inspects the live schema first and skips any column that already exists.
    Returns the list of "table.column" names that were added.
    """
    engine = engine or database.engine
    added = []
    with engine.begin() as conn:
        inspector = inspect(conn)
        for table, columns in ADDITIVE_COLUMNS.items():
            if not inspector.has_table(table):
                print(f"Table {table} does not exist yet, skipping (created by create_all on startup).")
                continue
            existing = {c["name"] for c in inspector.get_columns(table)}
            for name, sqlite_ddl, mysql_ddl in columns:
                ddl = mysql_ddl if engine.dialect.name == "mysql" else sqlite_ddl
                if name in existing:
                    print(f"Column {table}.{name} already exists, skipping")
                    continue
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))
                print(f"Added column {table}.{name}")
                added.append(f"{table}.{name}")
    return added


if __name__ == "__main__":
    if database.engine.dialect.name == "mysql":
        migrate_roleready_schema()
    apply_additive_columns()
