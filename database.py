import os
from dotenv import load_dotenv
from sqlalchemy import create_engine, Column, Integer, String, Boolean, ForeignKey, Table, DateTime, Text, Float, func, JSON
from sqlalchemy.orm import declarative_base, sessionmaker, relationship

load_dotenv()

# Amvera передаёт DATABASE_URL автоматически
DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    # Для локальной разработки
    DATABASE_URL = "postgresql+psycopg2://timetable_user:timetable2024!@localhost:5432/school_timetable"

# Создаём пул соединений (SQLite не поддерживает параметры пула QueuePool)
if DATABASE_URL.startswith("sqlite"):
    engine = create_engine(DATABASE_URL, pool_pre_ping=True, echo=False)
else:
    engine = create_engine(
        DATABASE_URL,
        pool_size=20,
        max_overflow=10,
        pool_timeout=30,
        pool_recycle=1800,
        pool_pre_ping=True,
        echo=False
    )

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    full_name = Column(String(255), nullable=False)
    school_name = Column(String(255), nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    schools = relationship("School", back_populates="owner", cascade="all, delete-orphan")
    saved_timetables = relationship("SavedTimetable", back_populates="owner", cascade="all, delete-orphan")


class School(Base):
    __tablename__ = "schools"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=False)
    settings = Column(JSON, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    owner = relationship("User", back_populates="schools")
    teachers = relationship("Teacher", back_populates="school", cascade="all, delete-orphan")


class Teacher(Base):
    __tablename__ = "teachers"

    id = Column(Integer, primary_key=True, index=True)
    school_id = Column(Integer, ForeignKey("schools.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=False)
    lessons = Column(JSON, nullable=False)
    availability = Column(JSON, nullable=False)
    max_days_per_week = Column(Integer, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    school = relationship("School", back_populates="teachers")


class SavedTimetable(Base):
    __tablename__ = "saved_timetables"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    data = Column(JSON, nullable=False)
    result = Column(JSON, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    owner = relationship("User", back_populates="saved_timetables")


def init_db():
    Base.metadata.create_all(bind=engine)
    print("✅ База данных PostgreSQL инициализирована")


def get_db():
    db = SessionLocal()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()