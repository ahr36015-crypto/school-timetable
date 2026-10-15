from pydantic import BaseModel
from typing import Dict, List, Optional

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

class TeacherSchedule(BaseModel):
    teacher: str
    schedule: Dict[str, Dict[int, List[LessonAssignment]]]
    total_lessons: int

class TimetableResponse(BaseModel):
    status: str
    solution_time: float
    teachers: List[TeacherSchedule]
    validation_errors: List[str] = []

class TeacherValidation(BaseModel):
    teacher: str
    hours: int
    slots: int
    valid: bool

class ValidationResponse(BaseModel):
    is_valid: bool
    teachers: List[TeacherValidation]
    errors: List[str] = []