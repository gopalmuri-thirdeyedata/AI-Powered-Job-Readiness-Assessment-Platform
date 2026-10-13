"""
Idempotent migration script for Phase 1 Student Career & Placement Platform.
Provisions `student_profiles` and `student_resumes` tables safely without dropping data.
"""
import os
import sys
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

# Ensure backend root is on sys.path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
load_dotenv()

import database

def migrate_student_schema():
    print("=" * 60)
    print("MIGRATING STUDENT CAREER & PLACEMENT SCHEMA (PHASE 1)")
    print("=" * 60)

    engine = database.engine

    with engine.connect() as conn:
        # 1. Create student_profiles table if not exists
        print("1. Creating student_profiles table if not exists...")
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS student_profiles (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL UNIQUE,
                organization_id INT NULL,
                full_name VARCHAR(150) NOT NULL DEFAULT 'Student',
                email VARCHAR(150) NOT NULL,
                phone VARCHAR(50) NULL,
                college_name VARCHAR(200) NULL,
                branch VARCHAR(100) NULL,
                graduation_year INT NULL,
                cgpa FLOAT NULL,
                target_role VARCHAR(100) NOT NULL DEFAULT 'Software Engineer',
                target_company VARCHAR(100) NULL,
                current_skills JSON NULL,
                education_data JSON NULL,
                experience_data JSON NULL,
                projects_data JSON NULL,
                readiness_score FLOAT NOT NULL DEFAULT 0.0,
                readiness_breakdown JSON NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_student_email (email),
                INDEX idx_student_user (user_id),
                INDEX idx_student_org (organization_id),
                CONSTRAINT fk_student_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                CONSTRAINT fk_student_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        """))

        # 2. Create student_resumes table if not exists
        print("2. Creating student_resumes table if not exists...")
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS student_resumes (
                id INT AUTO_INCREMENT PRIMARY KEY,
                student_profile_id INT NOT NULL,
                version INT NOT NULL DEFAULT 1,
                file_path VARCHAR(255) NOT NULL,
                file_name VARCHAR(255) NOT NULL,
                full_text LONGTEXT NULL,
                overall_score FLOAT NOT NULL DEFAULT 0.0,
                ats_score FLOAT NOT NULL DEFAULT 0.0,
                analysis_data JSON NULL,
                strengths JSON NULL,
                weaknesses JSON NULL,
                missing_information JSON NULL,
                recommendations JSON NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_resume_profile (student_profile_id),
                CONSTRAINT fk_resume_student_profile FOREIGN KEY (student_profile_id) REFERENCES student_profiles(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        """))

        # 3. Create student_roadmaps table if not exists (Phase 3)
        print("3. Creating student_roadmaps table if not exists...")
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS student_roadmaps (
                id INT AUTO_INCREMENT PRIMARY KEY,
                student_profile_id INT NOT NULL,
                organization_id INT NOT NULL,
                target_role VARCHAR(100) NOT NULL,
                title VARCHAR(255) NOT NULL,
                summary TEXT NULL,
                total_weeks INT NOT NULL DEFAULT 4,
                current_week INT NOT NULL DEFAULT 1,
                status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_roadmap_profile (student_profile_id),
                INDEX idx_roadmap_org (organization_id),
                CONSTRAINT fk_roadmap_profile FOREIGN KEY (student_profile_id) REFERENCES student_profiles(id) ON DELETE CASCADE,
                CONSTRAINT fk_roadmap_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        """))

        # 4. Create student_daily_tasks table if not exists (Phase 3)
        print("4. Creating student_daily_tasks table if not exists...")
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS student_daily_tasks (
                id INT AUTO_INCREMENT PRIMARY KEY,
                roadmap_id INT NOT NULL,
                student_profile_id INT NOT NULL,
                organization_id INT NOT NULL,
                week_number INT NOT NULL,
                day_number INT NOT NULL,
                title VARCHAR(255) NOT NULL,
                description TEXT NULL,
                category VARCHAR(50) NOT NULL DEFAULT 'TECHNICAL_SKILL',
                why_recommended TEXT NULL,
                estimated_minutes INT NOT NULL DEFAULT 45,
                status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
                completed_at DATETIME NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_task_roadmap (roadmap_id),
                INDEX idx_task_profile (student_profile_id),
                INDEX idx_task_org (organization_id),
                INDEX idx_task_status (status),
                CONSTRAINT fk_task_roadmap FOREIGN KEY (roadmap_id) REFERENCES student_roadmaps(id) ON DELETE CASCADE,
                CONSTRAINT fk_task_profile FOREIGN KEY (student_profile_id) REFERENCES student_profiles(id) ON DELETE CASCADE,
                CONSTRAINT fk_task_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        """))

        # 5. Create student_practice_questions table if not exists (Phase 4)
        print("5. Creating student_practice_questions table if not exists...")
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS student_practice_questions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                topic VARCHAR(100) NOT NULL,
                category VARCHAR(50) NOT NULL,
                difficulty VARCHAR(20) NOT NULL DEFAULT 'Medium',
                title VARCHAR(255) NOT NULL,
                description TEXT NOT NULL,
                options JSON NULL,
                correct_answer VARCHAR(255) NOT NULL,
                starter_code JSON NULL,
                test_cases JSON NULL,
                explanation TEXT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_pq_topic (topic),
                INDEX idx_pq_category (category),
                INDEX idx_pq_diff (difficulty)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        """))

        # 6. Create student_practice_attempts table if not exists (Phase 4)
        print("6. Creating student_practice_attempts table if not exists...")
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS student_practice_attempts (
                id INT AUTO_INCREMENT PRIMARY KEY,
                student_profile_id INT NOT NULL,
                organization_id INT NOT NULL,
                question_id INT NOT NULL,
                category VARCHAR(50) NOT NULL,
                topic VARCHAR(100) NOT NULL,
                code_submitted TEXT NULL,
                language VARCHAR(50) NULL,
                selected_option VARCHAR(255) NULL,
                is_correct BOOLEAN NOT NULL DEFAULT FALSE,
                tests_passed INT NOT NULL DEFAULT 0,
                total_tests INT NOT NULL DEFAULT 0,
                execution_time_ms INT NULL,
                feedback TEXT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_pa_profile (student_profile_id),
                INDEX idx_pa_org (organization_id),
                INDEX idx_pa_question (question_id),
                CONSTRAINT fk_pa_profile FOREIGN KEY (student_profile_id) REFERENCES student_profiles(id) ON DELETE CASCADE,
                CONSTRAINT fk_pa_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
                CONSTRAINT fk_pa_question FOREIGN KEY (question_id) REFERENCES student_practice_questions(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        """))

        # 7. Create student_mock_interviews table if not exists (Phase 5)
        print("7. Creating student_mock_interviews table if not exists...")
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS student_mock_interviews (
                id INT AUTO_INCREMENT PRIMARY KEY,
                student_profile_id INT NOT NULL,
                organization_id INT NOT NULL,
                interview_type VARCHAR(50) NOT NULL,
                target_role VARCHAR(100) NOT NULL,
                status VARCHAR(30) NOT NULL DEFAULT 'IN_PROGRESS',
                overall_score FLOAT NOT NULL DEFAULT 0.0,
                star_structure_score FLOAT NOT NULL DEFAULT 0.0,
                technical_accuracy_score FLOAT NOT NULL DEFAULT 0.0,
                feedback_summary TEXT NULL,
                strengths JSON NULL,
                areas_to_improve JSON NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                completed_at DATETIME NULL,
                INDEX idx_smi_profile (student_profile_id),
                INDEX idx_smi_org (organization_id),
                CONSTRAINT fk_smi_profile FOREIGN KEY (student_profile_id) REFERENCES student_profiles(id) ON DELETE CASCADE,
                CONSTRAINT fk_smi_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        """))

        # 8. Create student_mock_interview_turns table if not exists (Phase 5)
        print("8. Creating student_mock_interview_turns table if not exists...")
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS student_mock_interview_turns (
                id INT AUTO_INCREMENT PRIMARY KEY,
                mock_interview_id INT NOT NULL,
                student_profile_id INT NOT NULL,
                organization_id INT NOT NULL,
                turn_number INT NOT NULL,
                question_text TEXT NOT NULL,
                student_response TEXT NULL,
                feedback TEXT NULL,
                turn_score FLOAT NOT NULL DEFAULT 0.0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_smit_interview (mock_interview_id),
                INDEX idx_smit_profile (student_profile_id),
                INDEX idx_smit_org (organization_id),
                CONSTRAINT fk_smit_interview FOREIGN KEY (mock_interview_id) REFERENCES student_mock_interviews(id) ON DELETE CASCADE,
                CONSTRAINT fk_smit_profile FOREIGN KEY (student_profile_id) REFERENCES student_profiles(id) ON DELETE CASCADE,
                CONSTRAINT fk_smit_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        """))

        # 9. Create student_projects table if not exists (Phase 6)
        print("9. Creating student_projects table if not exists...")
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS student_projects (
                id INT AUTO_INCREMENT PRIMARY KEY,
                student_profile_id INT NOT NULL,
                organization_id INT NOT NULL,
                title VARCHAR(255) NOT NULL,
                description TEXT NOT NULL,
                tech_stack JSON NULL,
                github_url VARCHAR(500) NULL,
                live_url VARCHAR(500) NULL,
                architecture_review TEXT NULL,
                completeness_score FLOAT NOT NULL DEFAULT 0.0,
                suggested_interview_questions JSON NULL,
                recommendations JSON NULL,
                bullet_point_improvements JSON NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_sp_profile (student_profile_id),
                INDEX idx_sp_org (organization_id),
                CONSTRAINT fk_sp_profile FOREIGN KEY (student_profile_id) REFERENCES student_profiles(id) ON DELETE CASCADE,
                CONSTRAINT fk_sp_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        """))

        # 10. Create student_placement_simulations table if not exists (Phase 7)
        print("10. Creating student_placement_simulations table if not exists...")
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS student_placement_simulations (
                id INT AUTO_INCREMENT PRIMARY KEY,
                student_profile_id INT NOT NULL,
                organization_id INT NOT NULL,
                target_role VARCHAR(100) NOT NULL,
                status VARCHAR(30) NOT NULL DEFAULT 'IN_PROGRESS',
                current_round INT NOT NULL DEFAULT 1,
                aptitude_score FLOAT NOT NULL DEFAULT 0.0,
                coding_score FLOAT NOT NULL DEFAULT 0.0,
                technical_interview_score FLOAT NOT NULL DEFAULT 0.0,
                hr_interview_score FLOAT NOT NULL DEFAULT 0.0,
                overall_score FLOAT NOT NULL DEFAULT 0.0,
                report_summary TEXT NULL,
                strengths JSON NULL,
                weaknesses JSON NULL,
                recommendations JSON NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                completed_at DATETIME NULL,
                INDEX idx_sps_profile (student_profile_id),
                INDEX idx_sps_org (organization_id),
                CONSTRAINT fk_sps_profile FOREIGN KEY (student_profile_id) REFERENCES student_profiles(id) ON DELETE CASCADE,
                CONSTRAINT fk_sps_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        """))

        # 11. Create student_placement_simulation_rounds table if not exists (Phase 7)
        print("11. Creating student_placement_simulation_rounds table if not exists...")
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS student_placement_simulation_rounds (
                id INT AUTO_INCREMENT PRIMARY KEY,
                simulation_id INT NOT NULL,
                student_profile_id INT NOT NULL,
                organization_id INT NOT NULL,
                round_number INT NOT NULL,
                round_type VARCHAR(50) NOT NULL,
                status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
                score FLOAT NOT NULL DEFAULT 0.0,
                round_data JSON NULL,
                feedback TEXT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                completed_at DATETIME NULL,
                INDEX idx_spsr_sim (simulation_id),
                INDEX idx_spsr_profile (student_profile_id),
                INDEX idx_spsr_org (organization_id),
                CONSTRAINT fk_spsr_sim FOREIGN KEY (simulation_id) REFERENCES student_placement_simulations(id) ON DELETE CASCADE,
                CONSTRAINT fk_spsr_profile FOREIGN KEY (student_profile_id) REFERENCES student_profiles(id) ON DELETE CASCADE,
                CONSTRAINT fk_spsr_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        """))

        # 12. Create student_copilot_messages table if not exists (Phase 8)
        print("12. Creating student_copilot_messages table if not exists...")
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS student_copilot_messages (
                id INT AUTO_INCREMENT PRIMARY KEY,
                student_profile_id INT NOT NULL,
                organization_id INT NOT NULL,
                role VARCHAR(20) NOT NULL,
                content TEXT NOT NULL,
                intent VARCHAR(50) NULL,
                context_metadata JSON NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_scm_profile (student_profile_id),
                INDEX idx_scm_org (organization_id),
                CONSTRAINT fk_scm_profile FOREIGN KEY (student_profile_id) REFERENCES student_profiles(id) ON DELETE CASCADE,
                CONSTRAINT fk_scm_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        """))

        # 13. Create placement_drives table if not exists (Phase 9)
        print("13. Creating placement_drives table if not exists...")
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS placement_drives (
                id INT AUTO_INCREMENT PRIMARY KEY,
                organization_id INT NOT NULL,
                company_name VARCHAR(255) NOT NULL,
                role_title VARCHAR(255) NOT NULL,
                description TEXT NOT NULL,
                eligibility_criteria TEXT NULL,
                minimum_cgpa FLOAT NOT NULL DEFAULT 0.0,
                required_skills JSON NULL,
                package_lpa FLOAT NULL,
                application_deadline DATETIME NULL,
                status VARCHAR(30) NOT NULL DEFAULT 'OPEN',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_pd_org (organization_id),
                INDEX idx_pd_status (status),
                CONSTRAINT fk_pd_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        """))

        # 14. Create placement_drive_applications table if not exists (Phase 9)
        print("14. Creating placement_drive_applications table if not exists...")
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS placement_drive_applications (
                id INT AUTO_INCREMENT PRIMARY KEY,
                drive_id INT NOT NULL,
                student_profile_id INT NOT NULL,
                organization_id INT NOT NULL,
                status VARCHAR(30) NOT NULL DEFAULT 'APPLIED',
                notes TEXT NULL,
                applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_pda_drive (drive_id),
                INDEX idx_pda_student (student_profile_id),
                INDEX idx_pda_org (organization_id),
                INDEX idx_pda_status (status),
                CONSTRAINT fk_pda_drive FOREIGN KEY (drive_id) REFERENCES placement_drives(id) ON DELETE CASCADE,
                CONSTRAINT fk_pda_student FOREIGN KEY (student_profile_id) REFERENCES student_profiles(id) ON DELETE CASCADE,
                CONSTRAINT fk_pda_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        """))

        # 15. Add is_onboarded and onboarding_step columns to student_profiles (Phase 10)
        print("15. Ensuring is_onboarded and onboarding_step columns on student_profiles...")
        existing_cols = conn.execute(text("""
            SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'student_profiles';
        """)).fetchall()
        col_names = {row[0] for row in existing_cols}

        if "is_onboarded" not in col_names:
            conn.execute(text("ALTER TABLE student_profiles ADD COLUMN is_onboarded BOOLEAN NOT NULL DEFAULT FALSE;"))
            print("  - Added is_onboarded column.")

        if "onboarding_step" not in col_names:
            conn.execute(text("ALTER TABLE student_profiles ADD COLUMN onboarding_step INT NOT NULL DEFAULT 1;"))
            print("  - Added onboarding_step column.")

        # 16. Ensure Phase 11 Performance Composite Indexes
        print("16. Ensuring Phase 11 performance composite indexes...")
        existing_indices = conn.execute(text("""
            SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'student_profiles';
        """)).fetchall()
        sp_index_names = {row[0] for row in existing_indices}

        if "idx_sp_org_readiness" not in sp_index_names:
            conn.execute(text("CREATE INDEX idx_sp_org_readiness ON student_profiles (organization_id, readiness_score);"))
            print("  - Created index idx_sp_org_readiness on student_profiles(organization_id, readiness_score).")

        pda_indices = conn.execute(text("""
            SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'placement_drive_applications';
        """)).fetchall()
        pda_index_names = {row[0] for row in pda_indices}

        if "idx_pda_drive_student" not in pda_index_names:
            conn.execute(text("CREATE INDEX idx_pda_drive_student ON placement_drive_applications (drive_id, student_profile_id);"))
            print("  - Created index idx_pda_drive_student on placement_drive_applications(drive_id, student_profile_id).")

        print("Migration completed successfully! Student & College tables (Phases 1-11) are ready.")

if __name__ == "__main__":
    migrate_student_schema()




