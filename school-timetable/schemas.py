from pydantic import BaseModel, EmailStr
from typing import Optional, List
from datetime import datetime


class UserCreate(BaseModel):
    email: str
    password: str
    full_name: str
    school_name: Optional[str] = None


class UserResponse(BaseModel):
    id: int
    email: str
    full_name: str
    school_name: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class UserLogin(BaseModel):
    email: str
    password: str


class Token(BaseModel):
    access_token: str
    token_type: str


class TeacherCreate(BaseModel):
    name: str
    lessons: List[dict]
    availability: dict
    max_days_per_week: Optional[int] = None


class TeacherResponse(BaseModel):
    id: int
    name: str
    lessons: List[dict]
    availability: dict
    max_days_per_week: Optional[int] = None
    created_at: datetime

    class Config:
        from_attributes = True


class TimetableSave(BaseModel):
    name: str
    description: Optional[str] = None
    data: dict
    result: Optional[dict] = None


class TimetableSaveResponse(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    data: dict
    result: Optional[dict] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True