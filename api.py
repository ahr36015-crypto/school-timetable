import os
from datetime import datetime, timedelta
from typing import Optional

from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from pydantic import BaseModel

# Локальные импорты
from database import init_db, get_db, User
from auth import get_password_hash, verify_password, create_access_token


# ==========================================
# PYDANTIC МОДЕЛИ (str вместо EmailStr, чтобы не требовать email-validator)
# ==========================================
class UserRegister(BaseModel):
    email: str
    password: str
    full_name: str
    school_name: Optional[str] = None


class UserLogin(BaseModel):
    email: str
    password: str


# ==========================================
# НАСТРОЙКА ПРИЛОЖЕНИЯ
# ==========================================
app = FastAPI(title="Генератор школьного расписания")

# Разрешаем CORS для фронтенда
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Монтируем папку static (где лежит index.html)
app.mount("/static", StaticFiles(directory="static"), name="static")


# Инициализация БД при старте
@app.on_event("startup")
def startup_event():
    init_db()
    print("✅ База данных инициализирована")


# ==========================================
# ЭНДПОИНТЫ
# ==========================================

# ГЛАВНАЯ СТРАНИЦА (отдаёт index.html)
@app.get("/", response_class=HTMLResponse)
async def read_root():
    index_path = os.path.join("static", "index.html")
    if os.path.exists(index_path):
        with open(index_path, "r", encoding="utf-8") as f:
            return f.read()
    return HTMLResponse("<h1>Файл static/index.html не найден</h1>", status_code=404)


@app.get("/health")
def health_check():
    return {"status": "ok", "message": "Сервер работает"}


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

    # ВАЖНО: передаем именно new_user.id, так как auth.py ожидает число
    access_token = create_access_token(
        data={"sub": new_user.id},
        expires_delta=timedelta(minutes=10080)
    )

    return {
        "message": "Регистрация успешна",
        "user_id": new_user.id,
        "access_token": access_token,
        "token_type": "bearer"
    }


@app.post("/login")
def login(user: UserLogin, db: Session = Depends(get_db)):
    db_user = db.query(User).filter(User.email == user.email).first()
    if not db_user or not verify_password(user.password, db_user.hashed_password):
        raise HTTPException(status_code=401, detail="Неверный email или пароль")

    # ВАЖНО: передаем именно db_user.id
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
# ЗАГЛУШКИ ДЛЯ ГЕНЕРАЦИИ И ЭКСПОРТА
# (Чтобы сервер точно запускался без ошибок импорта)
# ==========================================
@app.post("/generate")
def generate_timetable():
    return {"message": "Эндпоинт генерации работает"}


@app.post("/export/excel")
def export_excel():
    return {"message": "Эндпоинт Excel работает"}


@app.post("/export/pdf")
def export_pdf():
    return {"message": "Эндпоинт PDF работает"}