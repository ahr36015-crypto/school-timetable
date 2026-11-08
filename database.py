import os
from dotenv import load_dotenv
from sqlalchemy import create_engine, Column, Integer, String, Boolean, ForeignKey, Table, DateTime, Text, Float, func, JSON, text
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
    school_id = Column(Integer, ForeignKey("schools.id", ondelete="CASCADE"), nullable=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    data = Column(JSON, nullable=False)
    result = Column(JSON, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    owner = relationship("User", back_populates="saved_timetables")


class Substitution(Base):
    """Журнал замен. Изолирован по school_id."""
    __tablename__ = "substitutions"

    id = Column(Integer, primary_key=True, index=True)
    school_id = Column(Integer, ForeignKey("schools.id", ondelete="CASCADE"), nullable=True)
    date = Column(String(20), nullable=True)          # YYYY-MM-DD
    slot = Column(Integer, nullable=False, default=1)  # номер урока
    grade = Column(String(64), nullable=True)          # класс
    absent = Column(String(255), nullable=False)       # отсутствующий учитель
    substitute = Column(String(255), nullable=True)    # заменяющий ('' = нет замены)
    created_by_name = Column(String(255), nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    school = relationship("School")


class SchoolData(Base):
    """Справочники школы (предметы, классы, учителя, кабинеты).
    
    Общие для всех пользователей одной школы.
    """
    __tablename__ = "school_data"

    id = Column(Integer, primary_key=True, index=True)
    school_id = Column(Integer, ForeignKey("schools.id", ondelete="CASCADE"), nullable=False)
    data = Column(JSON, nullable=False, default={})  # {subjects, classes, teachers, classrooms, ...}
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    school = relationship("School")


class CombinedLessonRule(Base):
    """Постоянное правило совмещённого урока.

    Хранит конфигурацию: какой предмет, учитель, кабинет и какие классы
    должны учиться одновременно.
    """

    __tablename__ = "combined_lesson_rules"

    id = Column(Integer, primary_key=True, index=True)
    school_id = Column(
        Integer,
        ForeignKey("schools.id", ondelete="CASCADE"),
        nullable=True,
    )  # None = глобальное правило
    user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=True,
    )  # владелец правила (изоляция данных между пользователями)
    name = Column(String(255), default="")  # человеко-читаемое название
    subject = Column(String(255), nullable=False)  # предмет
    teacher = Column(String(255), nullable=False)  # ФИО учителя
    classroom = Column(String(255), nullable=True)  # общий кабинет
    classes = Column(JSON, nullable=False)  # ["1А", "1Б"]
    hours = Column(Float, nullable=False, default=1)  # часов на каждый класс
    week_index = Column(Integer, nullable=True)  # 0/1 или NULL
    days = Column(JSON, nullable=True)  # ["Понедельник", ...] или NULL
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )


def init_db():
    Base.metadata.create_all(bind=engine)
    print("✅ База данных PostgreSQL инициализирована")

    # Миграция: добавление колонки user_id в combined_lesson_rules
    with engine.connect() as conn:
        try:
            conn.execute(text("""
                ALTER TABLE combined_lesson_rules 
                ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
            """))
            conn.commit()
            print("✅ Миграция: добавлена колонка user_id в combined_lesson_rules")
        except Exception as e:
            if "already exists" in str(e) or "duplicate column" in str(e):
                print("ℹ️ Колонка user_id уже существует")
            else:
                print(f"⚠️ Ошибка миграции: {e}")

    # Миграция: добавление колонки school_id в substitutions
    with engine.connect() as conn:
        try:
            conn.execute(text("""
                ALTER TABLE substitutions 
                ADD COLUMN school_id INTEGER REFERENCES schools(id) ON DELETE CASCADE;
            """))
            conn.commit()
            print("✅ Миграция: добавлена колонка school_id в substitutions")
        except Exception as e:
            if "already exists" in str(e) or "duplicate column" in str(e):
                print("ℹ️ Колонка school_id уже существует в substitutions")
            else:
                print(f"⚠️ Ошибка миграции substitutions: {e}")

    # Миграция: добавление колонки school_id в saved_timetables
    with engine.connect() as conn:
        try:
            conn.execute(text("""
                ALTER TABLE saved_timetables 
                ADD COLUMN school_id INTEGER REFERENCES schools(id) ON DELETE CASCADE;
            """))
            conn.commit()
            print("✅ Миграция: добавлена колонка school_id в saved_timetables")
        except Exception as e:
            if "already exists" in str(e) or "duplicate column" in str(e):
                print("ℹ️ Колонка school_id уже существует в saved_timetables")
            else:
                print(f"⚠️ Ошибка миграции saved_timetables: {e}")


def get_db():
    db = SessionLocal()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()