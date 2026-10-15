import os
import io
import re
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List

from fastapi import FastAPI, HTTPException, Depends, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from pydantic import BaseModel

from database import init_db, get_db, User, SavedTimetable
from auth import get_password_hash, verify_password, create_access_token, get_current_user
from models import (
    TimetableRequest, TimetableResponse,
    SchoolProfile, ClassItem, TeacherItem, SubjectItem, ClassroomItem,
    WorkloadItem, AIInputRequest, ManualEditRequest
)
from solver import validate_teachers, solve_timetable
from excel_generator import generate_teachers_excel, generate_classes_excel
from pdf_generator import generate_teachers_pdf, generate_classes_pdf


# ============================================================
# Pydantic-модели для авторизации
# ============================================================
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


# ============================================================
# Приложение FastAPI
# ============================================================
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


# ============================================================
# Главная страница
# ============================================================
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


# ============================================================
# Авторизация
# ============================================================
@app.post("/register")
def register(user: UserRegister, db: Session = Depends(get_db)):
    db_user = db.query(User).filter(User.email == user.email).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Email уже зарегистрирован")

    new_user = User(
        email=user.email,
        hashed_password=get_password_hash(user.password),
        full_name=user.full_name,
        school_name=user.school_name,
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    access_token = create_access_token(
        data={"sub": new_user.id},
        expires_delta=timedelta(minutes=10080),
    )

    return {
        "message": "Регистрация успешна",
        "user_id": new_user.id,
        "access_token": access_token,
        "token_type": "bearer",
        "full_name": new_user.full_name,
    }


@app.post("/login")
def login(user: UserLogin, db: Session = Depends(get_db)):
    db_user = db.query(User).filter(User.email == user.email).first()
    if not db_user or not verify_password(user.password, db_user.hashed_password):
        raise HTTPException(status_code=401, detail="Неверный email или пароль")

    access_token = create_access_token(
        data={"sub": db_user.id},
        expires_delta=timedelta(minutes=10080),
    )

    return {
        "message": "Вход выполнен успешно",
        "user_id": db_user.id,
        "full_name": db_user.full_name,
        "school_name": db_user.school_name,
        "access_token": access_token,
        "token_type": "bearer",
    }


# ============================================================
# AI-парсинг текста (имитация ИИ)
# ============================================================
@app.post("/api/ai-parse")
def ai_parse_text(
    request: AIInputRequest,
    current_user: User = Depends(get_current_user),
):
    """Парсит текст и извлекает данные об учителе."""
    text = request.text
    result = {
        "teacher_name": "",
        "lessons": [],
        "availability": {},
        "max_days": 5,
    }

    # Извлекаем имя учителя (первое предложение до "может" или "ведет")
    name_match = re.search(r'^Учитель\s+([А-Яа-я\s]+?)(?:\s+может|\s+ведет|\s+преподает)', text, re.IGNORECASE)
    if name_match:
        result["teacher_name"] = name_match.group(1).strip()
    else:
        name_match = re.search(r'^([А-Яа-я\s]+?)\s+(?:может|ведет|преподает)', text)
        if name_match:
            result["teacher_name"] = name_match.group(1).strip()

    # Извлекаем предметы и классы
    lesson_patterns = [
        r'ведет\s+урок\s+([А-Яа-я\s]+?)\s+в\s+(\d+(?:-\d+)?)\s*класс',
        r'преподает\s+([А-Яа-я\s]+?)\s+(\d+(?:,\s*\d+)*)\s*класс',
        r'([А-Яа-я\s]+?)\s+в\s+(\d+(?:-\d+)?)\s*класс',
    ]
    for pattern in lesson_patterns:
        matches = re.findall(pattern, text, re.IGNORECASE)
        for match in matches:
            subject = match[0].strip()
            grades = match[1].strip()
            result["lessons"].append({
                "subject": subject,
                "grade": grades,
                "hours": 2  # по умолчанию
            })

    # Извлекаем доступность по дням
    days_map = {
        "понедельник": "Понедельник", "вторник": "Вторник", "среда": "Среда",
        "четверг": "Четверг", "пятница": "Пятница", "суббота": "Суббота"
    }
    for day_ru, day_norm in days_map.items():
        if day_ru in text.lower():
            # Ищем ограничения времени
            if "до 15" in text.lower() or "до 15:00" in text.lower():
                if day_ru == "вторник":
                    result["availability"][day_norm] = [1, 2, 3, 4, 5]
            elif "до 5 урока" in text.lower() or "до 5-го урока" in text.lower():
                result["availability"][day_norm] = [1, 2, 3, 4, 5]
            elif "до 4 урока" in text.lower():
                result["availability"][day_norm] = [1, 2, 3, 4]
            elif "до 13" in text.lower() or "до 13:00" in text.lower():
                result["availability"][day_norm] = [1, 2, 3, 4]
            elif "до 14" in text.lower() or "до 14:20" in text.lower():
                result["availability"][day_norm] = [1, 2, 3, 4]
            elif "до 16" in text.lower() or "до 16:00" in text.lower():
                result["availability"][day_norm] = [1, 2, 3, 4, 5, 6]
            elif "с 6 урока" in text.lower() or "с 6-го урока" in text.lower():
                result["availability"][day_norm] = [6, 7]
            elif "с 7 урока" in text.lower():
                result["availability"][day_norm] = [7]
            elif "с 12" in text.lower() or "с 12:30" in text.lower():
                result["availability"][day_norm] = [5, 6, 7]
            elif "с 13" in text.lower() or "с 13:00" in text.lower():
                result["availability"][day_norm] = [5, 6, 7]
            elif "после 15" in text.lower() or "после 15:00" in text.lower():
                result["availability"][day_norm] = [6, 7]
            elif "в первой половине" in text.lower():
                result["availability"][day_norm] = [1, 2, 3, 4]
            elif "весь день" in text.lower():
                result["availability"][day_norm] = [1, 2, 3, 4, 5, 6, 7]
            elif "в любое время" in text.lower():
                result["availability"][day_norm] = [1, 2, 3, 4, 5, 6, 7]
            elif "1,2 урок" in text.lower() or "1-2 урок" in text.lower():
                result["availability"][day_norm] = [1, 2]
            elif "1-4 урок" in text.lower():
                result["availability"][day_norm] = [1, 2, 3, 4]
            elif "2 по 5 урок" in text.lower() or "2-5 урок" in text.lower():
                result["availability"][day_norm] = [2, 3, 4, 5]
            elif "с 6 урока" in text.lower():
                result["availability"][day_norm] = [6, 7]
            else:
                result["availability"][day_norm] = [1, 2, 3, 4, 5, 6, 7]

    return result


# ============================================================
# Генерация расписания
# ============================================================
def response_to_dict(result: TimetableResponse, request: TimetableRequest) -> Dict[str, Any]:
    return {
        "status": result.status,
        "solution_time": result.solution_time,
        "days": request.days,
        "slots": request.slots,
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
                },
            }
            for t in result.teachers
        ],
        "validation_errors": result.validation_errors,
    }


@app.post("/generate")
def generate_timetable(
    request: TimetableRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        is_valid, teacher_stats, errors = validate_teachers(request)
        if not is_valid:
            return {
                "message": "Ошибки валидации",
                "status": "INVALID",
                "errors": errors,
                "teacher_stats": teacher_stats,
            }

        result: TimetableResponse = solve_timetable(request)

        if result.status not in ("OPTIMAL", "FEASIBLE"):
            return {
                "message": "Не удалось составить расписание",
                "status": result.status,
                "solution_time": result.solution_time,
                "validation_errors": result.validation_errors or ["Проверьте ограничения"],
            }

        data_dict = response_to_dict(result, request)
        saved = SavedTimetable(
            user_id=current_user.id,
            name=f"Расписание {datetime.utcnow().strftime('%d.%m.%Y %H:%M')}",
            data=data_dict,
        )
        db.add(saved)
        db.commit()
        db.refresh(saved)

        return {
            "message": "Расписание сгенерировано",
            "id": saved.id,
            "status": result.status,
            "solution_time": result.solution_time,
            "validation_errors": result.validation_errors,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка генерации: {str(e)}")


# ============================================================
# CRUD расписаний
# ============================================================
@app.get("/timetables")
def get_timetables(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    timetables = (
        db.query(SavedTimetable)
        .filter(SavedTimetable.user_id == current_user.id)
        .order_by(SavedTimetable.created_at.desc())
        .all()
    )
    return [
        {
            "id": t.id,
            "name": t.name,
            "created_at": t.created_at.isoformat() if t.created_at else None,
            "data": t.data,
        }
        for t in timetables
    ]


@app.get("/timetables/{timetable_id}")
def get_timetable(
    timetable_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    timetable = (
        db.query(SavedTimetable)
        .filter(SavedTimetable.id == timetable_id, SavedTimetable.user_id == current_user.id)
        .first()
    )
    if not timetable:
        raise HTTPException(status_code=404, detail="Расписание не найдено")
    return {
        "id": timetable.id,
        "name": timetable.name,
        "created_at": timetable.created_at.isoformat() if timetable.created_at else None,
        "data": timetable.data,
    }


@app.put("/timetables/{timetable_id}")
def update_timetable(
    timetable_id: int,
    update_data: TimetableUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    timetable = (
        db.query(SavedTimetable)
        .filter(SavedTimetable.id == timetable_id, SavedTimetable.user_id == current_user.id)
        .first()
    )
    if not timetable:
        raise HTTPException(status_code=404, detail="Расписание не найдено")
    if update_data.name is not None:
        timetable.name = update_data.name
    if update_data.data is not None:
        timetable.data = update_data.data
    db.commit()
    db.refresh(timetable)
    return {"message": "Расписание обновлено", "id": timetable.id, "name": timetable.name}


@app.delete("/timetables/{timetable_id}")
def delete_timetable(
    timetable_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    timetable = (
        db.query(SavedTimetable)
        .filter(SavedTimetable.id == timetable_id, SavedTimetable.user_id == current_user.id)
        .first()
    )
    if not timetable:
        raise HTTPException(status_code=404, detail="Расписание не найдено")
    db.delete(timetable)
    db.commit()
    return {"message": "Расписание удалено"}


# ============================================================
# Экспорт
# ============================================================
@app.get("/timetables/{timetable_id}/export/excel")
def export_excel(
    timetable_id: int,
    format: str = Query("teachers", regex="^(teachers|classes)$"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    timetable = (
        db.query(SavedTimetable)
        .filter(SavedTimetable.id == timetable_id, SavedTimetable.user_id == current_user.id)
        .first()
    )
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
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@app.get("/timetables/{timetable_id}/export/pdf")
def export_pdf(
    timetable_id: int,
    format: str = Query("teachers", regex="^(teachers|classes)$"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    timetable = (
        db.query(SavedTimetable)
        .filter(SavedTimetable.id == timetable_id, SavedTimetable.user_id == current_user.id)
        .first()
    )
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
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )