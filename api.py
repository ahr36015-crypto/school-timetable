import os
import io
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any

from fastapi import FastAPI, HTTPException, Depends, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from pydantic import BaseModel

from database import init_db, get_db, User, SavedTimetable
from auth import get_password_hash, verify_password, create_access_token, get_current_user
from models import (
    TimetableRequest, TimetableResponse, TeacherSchedule, LessonAssignment
)
from solver import validate_teachers, solve_timetable
from excel_generator import generate_teachers_excel, generate_classes_excel
from pdf_generator import generate_teachers_pdf, generate_classes_pdf

# Pydantic модели для авторизации
class UserRegister(BaseModel):
    email: str
    password: str
    full_name: str
    school_name: Optional[str] = None

class UserLogin(BaseModel):
    email: str
    password: str

class TimetableUpdate(BaseModel):
    name: Optional[str] = None
    data: Optional[Dict[str, Any]] = None

# FastAPI приложение
app = FastAPI(title="Генератор школьного расписания")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory="static"), name="static")

@app.on_event("startup")
def startup_event():
    init_db()
    print("✅ База данных инициализирована")

# Главная страница
@app.get("/", response_class=HTMLResponse)
async def read_root():
    index_path = os.path.join("static", "index.html")
    if os.path.exists(index_path):
        with open(index_path, "r", encoding="utf-8") as f:
            return f.read()
    return HTMLResponse("<h1>Frontend not found</h1>", status_code=404)

@app.get("/health")
def health_check():
    return {"status": "ok"}

# Регистрация
@app.post("/register")
def register(user: UserRegister, db: Session = Depends(get_db)):
    db_user = db.query(User).filter(User.email == user.email).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Email уже зарегистрирован")

    new_user = User(
        email=user.email,
        hashed_password=get_password_hash(user.password),
        full_name=user.full_name,
        school_name=user.school_name
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    access_token = create_access_token(
        data={"sub": new_user.id},
        expires_delta=timedelta(minutes=10080)
    )

    return {
        "message": "Регистрация успешна",
        "user_id": new_user.id,
        "access_token": access_token,
        "token_type": "bearer",
        "full_name": new_user.full_name
    }

# Вход
@app.post("/login")
def login(user: UserLogin, db: Session = Depends(get_db)):
    db_user = db.query(User).filter(User.email == user.email).first()
    if not db_user or not verify_password(user.password, db_user.hashed_password):
        raise HTTPException(status_code=401, detail="Неверный email или пароль")

    access_token = create_access_token(
        data={"sub": db_user.id},
        expires_delta=timedelta(minutes=10080)
    )

    return {
        "message": "Вход выполнен успешно",
        "user_id": db_user.id,
        "full_name": db_user.full_name,
        "school_name": db_user.school_name,
        "access_token": access_token,
        "token_type": "bearer"
    }

# Валидация учителей
@app.post("/validate")
def validate_teachers_endpoint(
    request: TimetableRequest,
    current_user: User = Depends(get_current_user)
):
    is_valid, teacher_stats, errors = validate_teachers(request)
    return {
        "is_valid": is_valid,
        "teachers": teacher_stats,
        "errors": errors
    }

# Генерация расписания
@app.post("/generate")
def generate_timetable(
    request: TimetableRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    try:
        # Валидация
        is_valid, teacher_stats, errors = validate_teachers(request)
        if not is_valid:
            return {
                "message": "Ошибки валидации",
                "status": "INVALID",
                "errors": errors,
                "teacher_stats": teacher_stats
            }

        # Генерация
        result: TimetableResponse = solve_timetable(request)

        # Конвертация в dict для сохранения
        result_dict = {
            "status": result.status,
            "solution_time": result.solution_time,
            "teachers": [
                {
                    "teacher": t.teacher,
                    "total_lessons": t.total_lessons,
                    "schedule": {
                        day: {
                            str(slot): [
                                {"subject": a.subject, "grade": a.grade, "teacher": a.teacher}
                                for a in assignments
                            ]
                            for slot, assignments in slots.items()
                        }
                        for day, slots in t.schedule.items()
                    }
                }
                for t in result.teachers
            ],
            "validation_errors": result.validation_errors,
            "days": request.days,
            "slots": request.slots
        }

        # Сохранение в БД
        saved = SavedTimetable(
            user_id=current_user.id,
            name=f"Расписание {datetime.utcnow().strftime('%d.%m.%Y %H:%M')}",
            data=result_dict
        )
        db.add(saved)
        db.commit()
        db.refresh(saved)

        return {
            "message": "Расписание сгенерировано",
            "id": saved.id,
            "status": result.status,
            "solution_time": result.solution_time,
            "validation_errors": result.validation_errors
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка генерации: {str(e)}")

# Получить все расписания
@app.get("/timetables")
def get_timetables(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    timetables = db.query(SavedTimetable).filter(
        SavedTimetable.user_id == current_user.id
    ).order_by(SavedTimetable.created_at.desc()).all()

    return [
        {
            "id": t.id,
            "name": t.name,
            "created_at": t.created_at.isoformat() if t.created_at else None,
            "data": t.data
        }
        for t in timetables
    ]

# Получить конкретное расписание
@app.get("/timetables/{timetable_id}")
def get_timetable(
    timetable_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    timetable = db.query(SavedTimetable).filter(
        SavedTimetable.id == timetable_id,
        SavedTimetable.user_id == current_user.id
    ).first()

    if not timetable:
        raise HTTPException(status_code=404, detail="Расписание не найдено")

    return {
        "id": timetable.id,
        "name": timetable.name,
        "created_at": timetable.created_at.isoformat() if timetable.created_at else None,
        "data": timetable.data
    }

# Обновить расписание
@app.put("/timetables/{timetable_id}")
def update_timetable(
    timetable_id: int,
    update_data: TimetableUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    timetable = db.query(SavedTimetable).filter(
        SavedTimetable.id == timetable_id,
        SavedTimetable.user_id == current_user.id
    ).first()

    if not timetable:
        raise HTTPException(status_code=404, detail="Расписание не найдено")

    if update_data.name is not None:
        timetable.name = update_data.name
    if update_data.data is not None:
        timetable.data = update_data.data

    db.commit()
    db.refresh(timetable)

    return {"message": "Расписание обновлено", "id": timetable.id, "name": timetable.name}

# Удалить расписание
@app.delete("/timetables/{timetable_id}")
def delete_timetable(
    timetable_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    timetable = db.query(SavedTimetable).filter(
        SavedTimetable.id == timetable_id,
        SavedTimetable.user_id == current_user.id
    ).first()

    if not timetable:
        raise HTTPException(status_code=404, detail="Расписание не найдено")

    db.delete(timetable)
    db.commit()

    return {"message": "Расписание удалено"}

# Экспорт в Excel
@app.get("/timetables/{timetable_id}/export/excel")
def export_excel(
    timetable_id: int,
    format: str = Query("teachers", regex="^(teachers|classes)$"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    timetable = db.query(SavedTimetable).filter(
        SavedTimetable.id == timetable_id,
        SavedTimetable.user_id == current_user.id
    ).first()

    if not timetable:
        raise HTTPException(status_code=404, detail="Расписание не найдено")

    data = timetable.data
    days = data.get("days", ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница"])
    slots = data.get("slots", [1, 2, 3, 4, 5, 6, 7])

    if format == "teachers":
        wb = generate_teachers_excel(data, days, slots)
        filename = f"timetable_teachers_{timetable_id}.xlsx"
    else:
        wb = generate_classes_excel(data, days, slots)
        filename = f"timetable_classes_{timetable_id}.xlsx"

    output = io.BytesIO()
    wb.save(output)
    output.seek(0)

    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

# Экспорт в PDF
@app.get("/timetables/{timetable_id}/export/pdf")
def export_pdf(
    timetable_id: int,
    format: str = Query("teachers", regex="^(teachers|classes)$"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    timetable = db.query(SavedTimetable).filter(
        SavedTimetable.id == timetable_id,
        SavedTimetable.user_id == current_user.id
    ).first()

    if not timetable:
        raise HTTPException(status_code=404, detail="Расписание не найдено")

    data = timetable.data
    days = data.get("days", ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница"])
    slots = data.get("slots", [1, 2, 3, 4, 5, 6, 7])

    if format == "teachers":
        pdf_bytes = generate_teachers_pdf(data, days, slots)
        filename = f"timetable_teachers_{timetable_id}.pdf"
    else:
        pdf_bytes = generate_classes_pdf(data, days, slots)
        filename = f"timetable_classes_{timetable_id}.pdf"

    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )