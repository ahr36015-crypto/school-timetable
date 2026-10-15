import os
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any

from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from pydantic import BaseModel

# Локальные импорты
from database import init_db, get_db, User, SavedTimetable
from auth import get_password_hash, verify_password, create_access_token, get_current_user


# ==========================================
# PYDANTIC МОДЕЛИ
# ==========================================
class UserRegister(BaseModel):
    email: str
    password: str
    full_name: str
    school_name: Optional[str] = None


class UserLogin(BaseModel):
    email: str
    password: str


class TimetableGenerate(BaseModel):
    name: str
    num_classes: int = 1
    data: Optional[Dict[str, Any]] = None


# ==========================================
# НАСТРОЙКА ПРИЛОЖЕНИЯ
# ==========================================
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


# ==========================================
# ЭНДПОИНТЫ АВТОРИЗАЦИИ
# ==========================================
@app.get("/", response_class=HTMLResponse)
async def read_root():
    index_path = os.path.join("static", "index.html")
    if os.path.exists(index_path):
        with open(index_path, "r", encoding="utf-8") as f:
            return f.read()
    return HTMLResponse("<h1>Файл static/index.html не найден</h1>", status_code=404)


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.post("/register")
def register(user: UserRegister, db: Session = Depends(get_db)):
    db_user = db.query(User).filter(User.email == user.email).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Этот email уже зарегистрирован")

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


# ==========================================
# ЭНДПОИНТЫ РАСПИСАНИЯ (РЕАЛЬНАЯ ЛОГИКА)
# ==========================================
@app.post("/generate")
def generate_timetable(
        timetable: TimetableGenerate,
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db)
):
    """Генерирует и сохраняет расписание"""
    try:
        # Создаем базовую структуру расписания
        timetable_data = {
            "name": timetable.name,
            "num_classes": timetable.num_classes,
            "created_at": datetime.utcnow().isoformat(),
            "classes": []
        }

        # Генерируем простые классы (заглушка для solver)
        for i in range(timetable.num_classes):
            timetable_data["classes"].append({
                "class_name": f"Класс {i + 1}",
                "lessons": [
                    {"day": "Понедельник", "time": "08:00", "subject": "Математика"},
                    {"day": "Понедельник", "time": "09:00", "subject": "Русский язык"},
                    {"day": "Вторник", "time": "08:00", "subject": "Физика"},
                    {"day": "Вторник", "time": "09:00", "subject": "История"},
                    {"day": "Среда", "time": "08:00", "subject": "Литература"},
                    {"day": "Среда", "time": "09:00", "subject": "Английский"},
                    {"day": "Четверг", "time": "08:00", "subject": "Биология"},
                    {"day": "Четверг", "time": "09:00", "subject": "География"},
                    {"day": "Пятница", "time": "08:00", "subject": "Физкультура"},
                    {"day": "Пятница", "time": "09:00", "subject": "Информатика"}
                ]
            })

        # Сохраняем в БД
        saved = SavedTimetable(
            user_id=current_user.id,
            name=timetable.name,
            data=timetable_data
        )
        db.add(saved)
        db.commit()
        db.refresh(saved)

        return {
            "message": "Расписание сгенерировано и сохранено",
            "id": saved.id,
            "name": saved.name,
            "data": timetable_data
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка генерации: {str(e)}")


@app.get("/timetables")
def get_timetables(
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db)
):
    """Получить список расписаний пользователя"""
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


@app.get("/timetables/{timetable_id}")
def get_timetable(
        timetable_id: int,
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db)
):
    """Получить конкретное расписание"""
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


@app.delete("/timetables/{timetable_id}")
def delete_timetable(
        timetable_id: int,
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db)
):
    """Удалить расписание"""
    timetable = db.query(SavedTimetable).filter(
        SavedTimetable.id == timetable_id,
        SavedTimetable.user_id == current_user.id
    ).first()

    if not timetable:
        raise HTTPException(status_code=404, detail="Расписание не найдено")

    db.delete(timetable)
    db.commit()

    return {"message": "Расписание удалено"}