import os
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any

from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from pydantic import BaseModel

from database import init_db, get_db, User, SavedTimetable
from auth import get_password_hash, verify_password, create_access_token, get_current_user


# Pydantic модели
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


class TimetableUpdate(BaseModel):
    name: Optional[str] = None
    data: Optional[Dict[str, Any]] = None


# FastAPI приложение
app = FastAPI(title="Генератор школьного расписания")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Статические файлы
app.mount("/static", StaticFiles(directory="static"), name="static")


# Инициализация БД
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


# Генерация расписания
@app.post("/generate")
def generate_timetable(
        timetable: TimetableGenerate,
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db)
):
    try:
        subjects = ["Математика", "Русский язык", "Литература", "Физика",
                    "История", "Биология", "География", "Английский",
                    "Физкультура", "Информатика", "Химия", "Обществознание"]
        days = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница"]

        timetable_data = {
            "name": timetable.name,
            "num_classes": timetable.num_classes,
            "created_at": datetime.utcnow().isoformat(),
            "classes": []
        }

        for i in range(timetable.num_classes):
            class_schedule = {
                "class_name": f"Класс {i + 1}",
                "lessons": []
            }

            for day in days:
                for hour in range(1, 8):
                    lesson = {
                        "day": day,
                        "time": f"{8 + hour - 1}:00-{9 + hour - 1}:00",
                        "subject": subjects[(i + hour) % len(subjects)],
                        "teacher": f"Учитель {(i + hour) % 5 + 1}",
                        "room": f"Кабинет {(i + hour) % 20 + 1}"
                    }
                    class_schedule["lessons"].append(lesson)

            timetable_data["classes"].append(class_schedule)

        saved = SavedTimetable(
            user_id=current_user.id,
            name=timetable.name,
            data=timetable_data
        )
        db.add(saved)
        db.commit()
        db.refresh(saved)

        return {
            "message": "Расписание сгенерировано",
            "id": saved.id,
            "name": saved.name,
            "data": timetable_data
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка: {str(e)}")


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

    timetable.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(timetable)

    return {
        "message": "Расписание обновлено",
        "id": timetable.id,
        "name": timetable.name,
        "data": timetable.data
    }


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