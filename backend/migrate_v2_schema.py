"""
HiringAI V2 Database Migration Script
Idempotent schema migration adding structured JobDescription fields
and Assessment V2 fields without breaking existing data.
"""
import sys
import sqlalchemy as sa
from database import engine

def run_migration():
    print("Starting HiringAI V2 schema migration...")
    inspector = sa.inspect(engine)
    
    # 1. Migrate job_descriptions
    jd_cols = {c['name'] for c in inspector.get_columns('job_descriptions')}
    jd_new_cols = [
        ("role", "VARCHAR(200) NULL"),
        ("required_skills", "JSON NULL"),
        ("preferred_skills", "JSON NULL"),
        ("responsibilities", "TEXT NULL"),
        ("experience_requirements", "VARCHAR(200) NULL"),
        ("specific_targets", "TEXT NULL"),
        ("expected_achievements", "TEXT NULL"),
        ("additional_requirements", "TEXT NULL"),
    ]
    
    with engine.begin() as conn:
        for col_name, col_type in jd_new_cols:
            if col_name not in jd_cols:
                sql = f"ALTER TABLE job_descriptions ADD COLUMN {col_name} {col_type}"
                print(f"Adding column '{col_name}' to 'job_descriptions'...")
                conn.execute(sa.text(sql))
            else:
                print(f"Column '{col_name}' already exists in 'job_descriptions'. Skipping.")
                
    # 2. Migrate assessments
    assessment_cols = {c['name'] for c in inspector.get_columns('assessments')}
    assessment_new_cols = [
        ("question_source", "VARCHAR(50) DEFAULT 'ai'"),
        ("submission_data", "JSON NULL"),
        ("evaluation_details", "JSON NULL"),
    ]
    
    with engine.begin() as conn:
        for col_name, col_type in assessment_new_cols:
            if col_name not in assessment_cols:
                sql = f"ALTER TABLE assessments ADD COLUMN {col_name} {col_type}"
                print(f"Adding column '{col_name}' to 'assessments'...")
                conn.execute(sa.text(sql))
            else:
                print(f"Column '{col_name}' already exists in 'assessments'. Skipping.")

    print("HiringAI V2 schema migration completed successfully!")

if __name__ == "__main__":
    try:
        run_migration()
    except Exception as e:
        print(f"Migration failed: {e}", file=sys.stderr)
        sys.exit(1)
