import os
from datetime import datetime, timedelta
from typing import Optional, List

from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr

# Локальные импорты (убедись, что эти функции есть в твоих файлах)
from database import init_db, get_db, User
from auth import get_password_hash, verify_password, create_access_token


# ==========================================
# PYDANTIC МОДЕЛИ (Решают проблему с JSON)
# ==========================================
class UserRegister(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    school_name: Optional[str] = None


class UserLogin(BaseModel):
    email: EmailStr
    password: str


# ==========================================
# НАСТРОЙКА ПРИЛОЖЕНИЯ
# ==========================================
app = FastAPI(title="Генератор школьного расписания")

# Разрешаем CORS (чтобы фронтенд мог обращаться к бэкенду)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Инициализация БД при старте
@app.on_event("startup")
def startup_event():
    init_db()
    print("✅ База данных инициализирована")


# ==========================================
# ЭНДПОИНТЫ
# ==========================================

@app.get("/health")
def health_check():
    return {"status": "ok", "message": "Сервер работает"}


@app.post("/register")
def register(user: UserRegister, db: Session = Depends(get_db)):
    # Проверяем, есть ли такой email
    db_user = db.query(User).filter(User.email == user.email).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Этот email уже зарегистрирован")

    # Создаем нового пользователя
    new_user = User(
        email=user.email,
        hashed_password=get_password_hash(user.password),
        full_name=user.full_name,
        school_name=user.school_name
    )

    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    # Генерируем токен
    access_token = create_access_token(
        data={"sub": new_user.email},
        secret_key=os.getenv("SECRET_KEY", "my-super-secret-key-12345-abc"),
        algorithm=os.getenv("ALGORITHM", "HS256"),
        expires_delta=timedelta(minutes=int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "10080")))
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

    access_token = create_access_token(
        data={"sub": db_user.email},
        secret_key=os.getenv("SECRET_KEY", "my-super-secret-key-12345-abc"),
        algorithm=os.getenv("ALGORITHM", "HS256"),
        expires_delta=timedelta(minutes=int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "10080")))
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
# (Чтобы сервер точно запустился, даже если импорты сломаны)
# ==========================================

@app.post("/generate")
def generate_timetable():
    return {"message": "Эндпоинт генерации работает. (Проверь названия функций в solver.py)"}


@app.post("/export/excel")
def export_excel():
    return {"message": "Эндпоинт Excel работает. (Проверь названия функций в excel_generator.py)"}


@app.post("/export/pdf")
def export_pdf():
    return {"message": "Эндпоинт PDF работает. (Проверь названия функций в pdf_generator.py)"}
