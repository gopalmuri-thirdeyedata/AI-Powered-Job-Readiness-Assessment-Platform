"""The student-assessment schema migration is additive, keeps existing rows and is safe to run repeatedly."""
from sqlalchemy import create_engine, inspect, text

import migrate_student_assessment_access as migration


def _old_database(path):
    """A database as it was before this feature: registrations without student_user_id and no reviews table."""
    engine = create_engine(f"sqlite:///{path}")
    with engine.begin() as conn:
        conn.execute(text(
            "CREATE TABLE candidate_registrations (id INTEGER PRIMARY KEY, registration_token_hash VARCHAR(64) NOT NULL, "
            "job_description_id INTEGER NOT NULL, organization_id INTEGER NOT NULL, name VARCHAR(150) NOT NULL, "
            "phone VARCHAR(50) NOT NULL, email VARCHAR(150) NOT NULL, status VARCHAR(30) NOT NULL, attempt_session_uuid VARCHAR(64))"))
        conn.execute(text(
            "INSERT INTO candidate_registrations (registration_token_hash, job_description_id, organization_id, name, phone, email, status, attempt_session_uuid) "
            "VALUES ('h', 1, 1, 'Old Candidate', '+14155550123', 'old@example.org', 'CONSUMED', 'sess-1')"))
    return engine


def test_migration_adds_column_index_and_table_and_keeps_existing_rows(tmp_path):
    engine = _old_database(tmp_path / "old.db")
    added = migration.apply(engine)
    assert "assessment_reviews" in added and "candidate_registrations.student_user_id" in added
    insp = inspect(engine)
    assert "student_user_id" in {c["name"] for c in insp.get_columns("candidate_registrations")}
    assert {"session_id", "student_user_id", "review_text", "word_count"} <= {c["name"] for c in insp.get_columns("assessment_reviews")}
    with engine.connect() as conn:
        row = conn.execute(text("SELECT name, email, status, attempt_session_uuid, student_user_id FROM candidate_registrations")).one()
    assert tuple(row) == ("Old Candidate", "old@example.org", "CONSUMED", "sess-1", None)   # untouched, still an accountless candidate


def test_migration_is_idempotent(tmp_path):
    engine = _old_database(tmp_path / "again.db")
    assert migration.apply(engine)
    assert migration.apply(engine) == []
    assert migration.apply(engine) == []
    with engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM candidate_registrations")).scalar() == 1


def test_review_is_unique_per_attempt_at_the_database_level(tmp_path):
    import models
    unique = [c for c in models.AssessmentReview.__table__.columns if c.name == "session_id"][0]
    assert unique.unique is True


def test_migration_recovers_from_every_partial_state(tmp_path):
    """An interrupted upgrade (or a restart half-way) leaves some pieces behind: each is completed, none is duplicated or lost."""
    # (a) column present, table and index missing
    engine = _old_database(tmp_path / "a.db")
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE candidate_registrations ADD COLUMN student_user_id INTEGER NULL"))
        conn.execute(text("UPDATE candidate_registrations SET student_user_id = 7"))
    added = migration.apply(engine)
    assert "assessment_reviews" in added and "candidate_registrations.student_user_id" not in added
    with engine.connect() as conn:
        assert conn.execute(text("SELECT student_user_id FROM candidate_registrations")).scalar() == 7   # existing value untouched

    # (b) table present, column missing
    engine = _old_database(tmp_path / "b.db")
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE assessment_reviews (id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL UNIQUE, "
                          "student_user_id INTEGER NOT NULL, review_text TEXT NOT NULL, word_count INTEGER NOT NULL, created_at DATETIME)"))
        conn.execute(text("INSERT INTO assessment_reviews (session_id, student_user_id, review_text, word_count) VALUES (1, 2, 'kept', 1)"))
    added = migration.apply(engine)
    assert "assessment_reviews" not in added and "candidate_registrations.student_user_id" in added
    with engine.connect() as conn:
        assert conn.execute(text("SELECT review_text FROM assessment_reviews")).scalar() == "kept"       # existing reviews survive

    # (c) a restart after a complete migration changes nothing
    assert migration.apply(engine) == []


def test_startup_applies_the_migration_after_the_schema_is_created():
    """main.py creates the tables first, then runs the additive migrations, and never lets a migration problem block start-up."""
    from pathlib import Path
    src = (Path(__file__).resolve().parents[1] / "main.py").read_text(encoding="utf-8")
    created = src.index("create_tables_with_retry()\n")
    hook = src.index("migrate_student_assessment_access.apply(database.engine)")
    assert created < hook
    block = src[src.rindex("try:", 0, hook):src.index("except Exception", hook) + 40]
    assert "except Exception" in block
