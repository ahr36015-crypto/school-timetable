from pydantic import BaseModel, Field, field_validator
from typing import Dict, List, Optional, Any
from enum import Enum


class Lesson(BaseModel):
    subject: str = ""
    grade: str = ""
    # академические часы в неделю; допускается 0.5 (половина пары ~22-25 мин)
    hours: float = Field(default=1, ge=0.5)
    classroom: Optional[str] = None
    # Чётность недели в двухнедельном цикле: None — каждую неделю, 0 — синяя, 1 — красная
    week_index: Optional[int] = Field(default=None, alias="weekIndex")

    model_config = {"populate_by_name": True}

    @field_validator("subject", "grade", mode="before")
    @classmethod
    def _coerce_str(cls, v):
        return "" if v is None else str(v).strip()

    @field_validator("hours", mode="before")
    @classmethod
    def _coerce_hours(cls, v):
        """Приводим часы к кратному 0.5 (минимум 0.5); None/''/NaN -> 1."""
        if v is None or v == "":
            return 1
        try:
            n = float(v)
        except (TypeError, ValueError):
            return 1
        if n <= 0:
            return 1
        n = round(n * 2) / 2
        return max(0.5, n)


class Teacher(BaseModel):
    lessons: List[Lesson]
    availability: Dict[str, List[int]]
    max_days_per_week: Optional[int] = None


class TimetableRequest(BaseModel):
    days: List[str] = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница"]
    slots: List[int] = [1, 2, 3, 4, 5, 6, 7]
    teachers: Dict[str, Teacher]
    lesson_times: List[str] = Field(default_factory=list, alias="lessonTimes")

    model_config = {"populate_by_name": True}


class LessonAssignment(BaseModel):
    subject: str
    grade: str
    teacher: str
    classroom: Optional[str] = None
    week_index: Optional[int] = None
    half: bool = False


class TeacherSchedule(BaseModel):
    teacher: str
    schedule: Dict[str, Dict[str, List[LessonAssignment]]]
    total_lessons: int


class TimetableResponse(BaseModel):
    status: str
    solution_time: float
    teachers: List[TeacherSchedule]
    validation_errors: List[str] = []


# ============================================================
# Модели для справочников и онбординга
# ============================================================
class SchoolProfile(BaseModel):
    name: str
    days_per_week: int = Field(5, ge=5, le=6)
    lessons_per_day: int = Field(7, ge=1, le=10)
    lesson_times: Optional[List[Dict[str, str]]] = None


class ClassItem(BaseModel):
    name: str
    grade: int
    letter: Optional[str] = None


class TeacherItem(BaseModel):
    full_name: str
    email: Optional[str] = None
    phone: Optional[str] = None


class SubjectItem(BaseModel):
    name: str
    category: str = "основной"


class ClassroomItem(BaseModel):
    number: str
    capacity: Optional[int] = None
    type: str = "обычный"


class WorkloadItem(BaseModel):
    teacher: str
    subject: str
    grade: str
    classroom: Optional[str] = None
    hours: int


class AIInputRequest(BaseModel):
    text: str


class ManualEditRequest(BaseModel):
    teacher: str
    day: str
    slot: int
    subject: Optional[str] = None
    grade: Optional[str] = None