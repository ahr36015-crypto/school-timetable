import os
from datetime import datetime, timedelta
from typing import Optional, List

from fastapi import FastAPI, HTTPException, Depends, UploadFile, File, Form
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr

from database import init_db, get_db, User, School, Teacher, SavedTimetable
from auth import get_password_hash, verify_password, create_access_token
from excel_generator import generate_excel
from pdf_generator import generate_pdf
from solver import validate_teachers, solve_timetable

# === ПЕРЕМЕННЫЕ ОКРУЖЕНИЯ ===
SECRET_KEY = os.getenv("SECRET_KEY", "my-super-secret-key-12345-abc")
ALGORITHM = os.getenv("ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "10080"))


# === PYDANTIC МОДЕЛИ ===
class UserRegister(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    school_name: Optional[str] = None


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class SchoolData(BaseModel):
    school_name: str
    teachers: List[dict]
    classes: List[dict]
    subjects: List[dict]
    availability: dict


class TimetableSave(BaseModel):
    name: str
    data: dict


# === FASTAPI ПРИЛОЖЕНИЕ ===
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


# === ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ===
def get_current_user(token: str = Form(...), db: Session = Depends(get_db)) -> User:
    """Получить текущего пользователя по токену (упрощённо)"""
    from jose import jwt, JWTError
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        if email is None:
            raise HTTPException(status_code=401, detail="Невалидный токен")
    except JWTError:
        raise HTTPException(status_code=401, detail="Невалидный токен")

    user = db.query(User).filter(User.email == email).first()
    if user is None:
        raise HTTPException(status_code=401, detail="Пользователь не найден")
    return user


# === ГЛАВНАЯ СТРАНИЦА ===
@app.get("/", response_class=HTMLResponse)
def read_root():
    with open("static/index.html", "r", encoding="utf-8") as f:
        return f.read()


@app.get("/health")
def health_check():
    return {"status": "ok"}


# === АВТОРИЗАЦИЯ ===
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
        data={"sub": new_user.email},
        secret_key=SECRET_KEY,
        algorithm=ALGORITHM,
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
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
        secret_key=SECRET_KEY,
        algorithm=ALGORITHM,
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    )

    return {
        "message": "Вход выполнен",
        "user_id": db_user.id,
        "full_name": db_user.full_name,
        "school_name": db_user.school_name,
        "access_token": access_token,
        "token_type": "bearer"
    }


# === ШКОЛЫ И УЧИТЕЛЯ ===
@app.post("/schools")
def create_school(school: SchoolData, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    new_school = School(
        user_id=current_user.id,
        name=school.school_name,
        settings=school.dict()
    )
    db.add(new_school)
    db.commit()
    db.refresh(new_school)
    return {"message": "Школа сохранена", "school_id": new_school.id}


@app.get("/schools")
def get_schools(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    schools = db.query(School).filter(School.user_id == current_user.id).all()
    return schools


# === ГЕНЕРАЦИЯ РАСПИСАНИЯ ===
@app.post("/generate")
def generate_timetable(
        data: SchoolData,
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db)
):
    try:
        teachers_valid = validate_teachers(data.teachers)
        if not teachers_valid:
            raise HTTPException(status_code=400, detail="Ошибка в данных учителей")

        timetable = solve_timetable(data)
        return {"message": "Расписание сгенерировано", "timetable": timetable}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# === СОХРАНЕНИЕ РАСПИСАНИЯ ===
@app.post("/timetables/save")
def save_timetable(
        timetable: TimetableSave,
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db)
):
    saved = SavedTimetable(
        user_id=current_user.id,
        name=timetable.name,
        data=timetable.data
    )
    db.add(saved)
    db.commit()
    db.refresh(saved)
    return {"message": "Расписание сохранено", "id": saved.id}


@app.get("/timetables")
def get_timetables(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    timetables = db.query(SavedTimetable).filter(SavedTimetable.user_id == current_user.id).all()
    return timetables


# === ЭКСПОРТ ===
@app.post("/export/excel")
def export_excel(
        data: dict,
        current_user: User = Depends(get_current_user)
):
    try:
        file_path = generate_excel(data)
        return FileResponse(file_path, media_type="application/vnd.ms-excel", filename="timetable.xlsx")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/export/pdf")
def export_pdf(
        data: dict,
        current_user: User = Depends(get_current_user)
):
    try:
        file_path = generate_pdf(data)
        return FileResponse(file_path, media_type="application/pdf", filename="timetable.pdf")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# === ЗАГРУЗКА ФАЙЛА ===
@app.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    content = await file.read()
    return {"message": f"Файл {file.filename} загружен", "size": len(content)}


# === ИНИЦИАЛИЗАЦИЯ БД ===
@app.on_event("startup")
def startup_event():
    init_db()
    print("✅ База данных инициализирована")