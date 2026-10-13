from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

import os
from urllib.parse import quote_plus
from dotenv import load_dotenv

env_path = os.path.join(os.path.dirname(__file__), ".env")
load_dotenv(env_path)
load_dotenv()

raw_db_url = os.getenv("DATABASE_URL", "").strip()
if raw_db_url:
    # Ensure MySQL driver uses pymysql if dialect specified as mysql://
    if raw_db_url.startswith("mysql://"):
        SQLALCHEMY_DATABASE_URL = raw_db_url.replace("mysql://", "mysql+pymysql://", 1)
    elif raw_db_url.startswith("sqlite:///") and not raw_db_url.startswith("sqlite:///:memory:"):
        db_path = raw_db_url.replace("sqlite:///", "", 1)
        if not os.path.isabs(db_path):
            backend_dir = os.path.dirname(os.path.abspath(__file__))
            abs_db_path = os.path.abspath(os.path.join(backend_dir, db_path)).replace("\\", "/")
            SQLALCHEMY_DATABASE_URL = f"sqlite:///{abs_db_path}"
        else:
            SQLALCHEMY_DATABASE_URL = raw_db_url
    else:
        SQLALCHEMY_DATABASE_URL = raw_db_url
else:
    DB_USER = os.getenv("DB_USER", "root")
    DB_PASSWORD = os.getenv("DB_PASSWORD", "")
    DB_HOST = os.getenv("DB_HOST", "127.0.0.1")
    DB_PORT = os.getenv("DB_PORT", "3306")
    DB_NAME = os.getenv("DB_NAME", "hiringai")
    encoded_password = quote_plus(DB_PASSWORD)
    SQLALCHEMY_DATABASE_URL = f"mysql+pymysql://{DB_USER}:{encoded_password}@{DB_HOST}:{DB_PORT}/{DB_NAME}"

# Production Connection Pool Configuration
engine_kwargs = {"pool_pre_ping": True}
if not SQLALCHEMY_DATABASE_URL.startswith("sqlite"):
    engine_kwargs.update({
        "pool_recycle": 3600,  # Recycle connections after 1 hour (avoids MySQL 8h wait_timeout)
        "pool_size": 10,       # Base connection pool size
        "max_overflow": 20     # Allow temporary burst connections
    })
else:
    engine_kwargs.update({"connect_args": {"check_same_thread": False}})

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    **engine_kwargs
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
