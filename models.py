from pydantic import BaseModel, Field
from typing import Dict, List, Optional, Any
from enum import Enum


class Lesson(BaseModel):
    subject: str
    grade: str
    hours: int


class Teacher(BaseModel):
    lessons: List[Lesson]
    availability: Dict[str, List[int]]
    max_days_per_week: Optional[int] = None


class TimetableRequest(BaseModel):
    days: List[str] = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница"]
    slots: List[int] = [1, 2, 3, 4, 5, 6, 7]
    teachers: Dict[str, Teacher]


class LessonAssignment(BaseModel):
    subject: str
    grade: str
    teacher: str
    classroom: Optional[str] = None


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
    hours: int


class AIInputRequest(BaseModel):
    text: str


class ManualEditRequest(BaseModel):
    teacher: str
    day: str
    slot: int
    subject: Optional[str] = None
    grade: Optional[str] = None