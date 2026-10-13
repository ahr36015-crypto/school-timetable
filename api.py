from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, Response
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from datetime import timedelta
from io import BytesIO

from dotenv import load_dotenv

load_dotenv()

from models import TimetableRequest, ValidationResponse, TimetableResponse
from solver import validate_teachers, solve_timetable
from pdf_generator import generate_teachers_pdf, generate_classes_pdf
from excel_generator import generate_teachers_excel, generate_classes_excel
from database import init_db, get_db, User, School, Teacher, SavedTimetable
from auth import verify_password, get_password_hash, create_access_token, get_current_user, ACCESS_TOKEN_EXPIRE_MINUTES

app = FastAPI(title="School Timetable Generator", version="3.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory="static"), name="static")

init_db()


# === СЕРИАЛИЗАТОР ===

def serialize_timetable(tt):
    """Преобразует объект SavedTimetable в словарь для JSON"""
    return {
        "id": tt.id,
        "name": tt.name,
        "description": tt.description or "",
        "data": tt.data,
        "result": tt.result,
        "created_at": tt.created_at.isoformat() if tt.created_at else None,
        "updated_at": tt.updated_at.isoformat() if tt.updated_at else None,
    }


# === ГЛАВНАЯ ===

@app.get("/", response_class=HTMLResponse)
def root():
    with open("static/index.html", "r", encoding="utf-8") as f:
        return f.read()


@app.get("/health")
def health_check():
    return {"status": "ok"}


# === АВТОРИЗАЦИЯ ===

@app.post("/register")
def register(email: str, password: str, full_name: str, school_name: str = None, db: Session = Depends(get_db)):
    db_user = db.query(User).filter(User.email == email).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Email уже зарегистрирован")

    new_user = User(
        email=email,
        hashed_password=get_password_hash(password),
        full_name=full_name,
        school_name=school_name
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    school = School(user_id=new_user.id, name=school_name or "Моя школа")
    db.add(school)
    db.commit()

    return {"id": new_user.id, "email": new_user.email, "full_name": new_user.full_name}


@app.post("/login")
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == form_data.username).first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Неверный email или пароль")

    access_token = create_access_token(
        data={"sub": user.id},
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    return {"access_token": access_token, "token_type": "bearer"}


@app.get("/me")
def get_me(current_user: User = Depends(get_current_user)):
    return {
        "id": current_user.id,
        "email": current_user.email,
        "full_name": current_user.full_name,
        "school_name": current_user.school_name
    }


# === СОХРАНЁННЫЕ РАСПИСАНИЯ ===

@app.get("/timetables")
def get_timetables(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    timetables = db.query(SavedTimetable).filter(
        SavedTimetable.user_id == current_user.id
    ).order_by(SavedTimetable.created_at.desc()).all()

    return [serialize_timetable(tt) for tt in timetables]


@app.post("/timetables")
def save_timetable(timetable: dict, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    new_tt = SavedTimetable(
        user_id=current_user.id,
        name=timetable.get("name", "Без названия"),
        description=timetable.get("description", ""),
        data=timetable.get("data", {}),
        result=timetable.get("result")
    )
    db.add(new_tt)
    db.commit()
    db.refresh(new_tt)
    return serialize_timetable(new_tt)


@app.get("/timetables/{timetable_id}")
def get_timetable(timetable_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    tt = db.query(SavedTimetable).filter(
        SavedTimetable.id == timetable_id,
        SavedTimetable.user_id == current_user.id
    ).first()

    if not tt:
        raise HTTPException(status_code=404, detail="Расписание не найдено")

    return serialize_timetable(tt)


@app.delete("/timetables/{timetable_id}")
def delete_timetable(timetable_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    tt = db.query(SavedTimetable).filter(
        SavedTimetable.id == timetable_id,
        SavedTimetable.user_id == current_user.id
    ).first()
    if not tt:
        raise HTTPException(status_code=404, detail="Расписание не найдено")
    db.delete(tt)
    db.commit()
    return {"message": "Расписание удалено"}


# === ГЕНЕРАЦИЯ ===

@app.post("/validate", response_model=ValidationResponse)
def validate_data(request: TimetableRequest):
    is_valid, teacher_stats, errors = validate_teachers(request)
    return ValidationResponse(
        is_valid=is_valid,
        teachers=teacher_stats,
        errors=errors
    )


@app.post("/generate", response_model=TimetableResponse)
def generate_timetable(request: TimetableRequest):
    is_valid, teacher_stats, errors = validate_teachers(request)
    if not is_valid:
        raise HTTPException(status_code=400, detail={"message": "Данные содержат ошибки", "errors": errors})

    result = solve_timetable(request)
    if result.status == "INFEASIBLE":
        raise HTTPException(status_code=422, detail={"message": "Не удалось составить расписание"})

    return result


@app.post("/generate-with-fallback")
def generate_timetable_with_fallback(request: TimetableRequest):
    result = solve_timetable(request)
    return result


# === ЭКСПОРТ ===

@app.post("/export-pdf/teachers")
def export_teachers_pdf(request: TimetableRequest):
    is_valid, _, errors = validate_teachers(request)
    if not is_valid:
        raise HTTPException(status_code=400, detail={"errors": errors})
    result = solve_timetable(request)
    if result.status == "INFEASIBLE":
        raise HTTPException(status_code=422, detail={"message": "Не удалось составить расписание"})

    result_dict = {'teachers': [{'teacher': t.teacher, 'total_lessons': t.total_lessons, 'schedule': {
        day: {str(slot): [{'subject': l.subject, 'grade': l.grade, 'teacher': l.teacher} for l in lessons] for
              slot, lessons in slots.items()} for day, slots in t.schedule.items()}} for t in result.teachers]}

    pdf_bytes = generate_teachers_pdf(result_dict, request.days, request.slots)
    return Response(content=pdf_bytes, media_type='application/pdf',
                    headers={'Content-Disposition': 'attachment; filename="timetable_teachers.pdf"'})


@app.post("/export-pdf/classes")
def export_classes_pdf(request: TimetableRequest):
    is_valid, _, errors = validate_teachers(request)
    if not is_valid:
        raise HTTPException(status_code=400, detail={"errors": errors})
    result = solve_timetable(request)
    if result.status == "INFEASIBLE":
        raise HTTPException(status_code=422, detail={"message": "Не удалось составить расписание"})

    result_dict = {'teachers': [{'teacher': t.teacher, 'total_lessons': t.total_lessons, 'schedule': {
        day: {str(slot): [{'subject': l.subject, 'grade': l.grade, 'teacher': l.teacher} for l in lessons] for
              slot, lessons in slots.items()} for day, slots in t.schedule.items()}} for t in result.teachers]}

    pdf_bytes = generate_classes_pdf(result_dict, request.days, request.slots)
    return Response(content=pdf_bytes, media_type='application/pdf',
                    headers={'Content-Disposition': 'attachment; filename="timetable_classes.pdf"'})


@app.post("/export-excel/teachers")
def export_teachers_excel(request: TimetableRequest):
    is_valid, _, errors = validate_teachers(request)
    if not is_valid:
        raise HTTPException(status_code=400, detail={"errors": errors})
    result = solve_timetable(request)
    if result.status == "INFEASIBLE":
        raise HTTPException(status_code=422, detail={"message": "Не удалось составить расписание"})

    result_dict = {'teachers': [{'teacher': t.teacher, 'total_lessons': t.total_lessons, 'schedule': {
        day: {str(slot): [{'subject': l.subject, 'grade': l.grade, 'teacher': l.teacher} for l in lessons] for
              slot, lessons in slots.items()} for day, slots in t.schedule.items()}} for t in result.teachers]}

    wb = generate_teachers_excel(result_dict, request.days, request.slots)
    output = BytesIO()
    wb.save(output)
    output.seek(0)
    return Response(content=output.getvalue(),
                    media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    headers={'Content-Disposition': 'attachment; filename="timetable_teachers.xlsx"'})


@app.post("/export-excel/classes")
def export_classes_excel(request: TimetableRequest):
    is_valid, _, errors = validate_teachers(request)
    if not is_valid:
        raise HTTPException(status_code=400, detail={"errors": errors})
    result = solve_timetable(request)
    if result.status == "INFEASIBLE":
        raise HTTPException(status_code=422, detail={"message": "Не удалось составить расписание"})

    result_dict = {'teachers': [{'teacher': t.teacher, 'total_lessons': t.total_lessons, 'schedule': {
        day: {str(slot): [{'subject': l.subject, 'grade': l.grade, 'teacher': l.teacher} for l in lessons] for
              slot, lessons in slots.items()} for day, slots in t.schedule.items()}} for t in result.teachers]}

    wb = generate_classes_excel(result_dict, request.days, request.slots)
    output = BytesIO()
    wb.save(output)
    output.seek(0)
    return Response(content=output.getvalue(),
                    media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    headers={'Content-Disposition': 'attachment; filename="timetable_classes.xlsx"'})


# === ТЕСТОВЫЕ ДАННЫЕ ===

SAMPLE_DATA = {
    "days": ["Пн", "Вт", "Ср", "Чт", "Пт"],
    "slots": [1, 2, 3, 4, 5, 6, 7],
    "teachers": {
        "Асланова": {
            "lessons": [
                {"subject": "Старт IT", "grade": "5-6", "hours": 2},
                {"subject": "Старт IT", "grade": "8", "hours": 2},
                {"subject": "ИИ", "grade": "6", "hours": 2},
                {"subject": "Информатика", "grade": "7-8", "hours": 2}
            ],
            "availability": {"Пн": [], "Вт": [1, 2, 3, 4, 5], "Ср": [1, 2, 3, 4, 5, 6, 7], "Чт": [],
                             "Пт": [1, 2, 3, 4, 5, 6, 7]}
        },
        "Леонтьев": {
            "lessons": [{"subject": "Старт IT", "grade": "7", "hours": 2}],
            "availability": {"Пн": [], "Вт": [5, 6, 7], "Ср": [5, 6, 7], "Чт": [6, 7], "Пт": [6, 7]}
        },
        "Пешкова": {
            "lessons": [
                {"subject": "Математика", "grade": "5", "hours": 4},
                {"subject": "Математика", "grade": "6", "hours": 4},
                {"subject": "ВиС", "grade": "7", "hours": 2}
            ],
            "availability": {"Пн": [], "Вт": [1, 2, 3, 4, 5], "Ср": [1, 2, 3, 4, 5], "Чт": [1, 2, 3, 4],
                             "Пт": [1, 2, 3, 4, 5]}
        },
        "Стариков": {
            "lessons": [
                {"subject": "Алгебра", "grade": "7", "hours": 3},
                {"subject": "Алгебра", "grade": "8", "hours": 3},
                {"subject": "Геометрия", "grade": "7", "hours": 2},
                {"subject": "Геометрия", "grade": "8", "hours": 2},
                {"subject": "ВиС", "grade": "8", "hours": 2},
                {"subject": "Домашку", "grade": "7", "hours": 2},
                {"subject": "Домашку", "grade": "8", "hours": 2}
            ],
            "availability": {"Пн": [], "Вт": [1, 2, 3, 4, 5, 6, 7], "Ср": [6, 7], "Чт": [1, 2, 3, 4, 5, 6, 7], "Пт": []}
        },
        "Разумова": {
            "lessons": [
                {"subject": "Английский", "grade": "5", "hours": 2},
                {"subject": "Английский", "grade": "6", "hours": 2},
                {"subject": "Английский", "grade": "7", "hours": 2},
                {"subject": "Английский", "grade": "8", "hours": 2},
                {"subject": "Speaking club", "grade": "5", "hours": 1},
                {"subject": "Speaking club", "grade": "6", "hours": 1},
                {"subject": "Speaking club", "grade": "7", "hours": 1},
                {"subject": "Speaking club", "grade": "8", "hours": 1}
            ],
            "availability": {"Пн": [4, 5, 6, 7], "Вт": [4, 5, 6, 7], "Ср": [5, 6, 7], "Чт": [3, 4, 5, 6, 7],
                             "Пт": [1, 2, 3, 4]}
        },
        "Баженова": {
            "lessons": [
                {"subject": "Технология", "grade": "5", "hours": 2},
                {"subject": "Технология", "grade": "6", "hours": 2},
                {"subject": "Технология", "grade": "7", "hours": 2},
                {"subject": "Технология", "grade": "8", "hours": 2},
                {"subject": "ИЗО", "grade": "5", "hours": 1},
                {"subject": "ИЗО", "grade": "6", "hours": 1},
                {"subject": "ИЗО", "grade": "7", "hours": 1},
                {"subject": "ИЗО", "grade": "8", "hours": 1}
            ],
            "availability": {"Пн": [1, 2, 3, 4, 5, 6, 7], "Вт": [1, 2, 3, 4, 5, 6, 7], "Ср": [1, 2, 3, 4, 5, 6, 7],
                             "Чт": [1, 2, 3, 4, 5, 6, 7], "Пт": [1, 2, 3, 4, 5, 6, 7]}
        },
        "Мозолина": {
            "lessons": [
                {"subject": "Английский", "grade": "1", "hours": 3},
                {"subject": "Английский", "grade": "2", "hours": 3},
                {"subject": "Английский", "grade": "3", "hours": 3},
                {"subject": "Speaking club", "grade": "1", "hours": 1},
                {"subject": "Speaking club", "grade": "2", "hours": 1},
                {"subject": "Speaking club", "grade": "3", "hours": 1}
            ],
            "availability": {"Пн": [2, 3, 4, 5], "Вт": [2, 3, 4, 5], "Ср": [2, 3, 4, 5], "Чт": [2, 3, 4, 5],
                             "Пт": [2, 3, 4, 5]},
            "max_days_per_week": 4
        },
        "Моисеенко": {
            "lessons": [
                {"subject": "География", "grade": "5", "hours": 2},
                {"subject": "География", "grade": "6", "hours": 2},
                {"subject": "География", "grade": "7", "hours": 2},
                {"subject": "География", "grade": "8", "hours": 2},
                {"subject": "История", "grade": "5", "hours": 2},
                {"subject": "История", "grade": "6", "hours": 2},
                {"subject": "История", "grade": "7", "hours": 2},
                {"subject": "История", "grade": "8", "hours": 2}
            ],
            "availability": {"Пн": [1, 2, 3, 4, 5, 6, 7], "Вт": [1, 2, 3, 4, 5, 6, 7], "Ср": [1, 2, 3, 4, 5, 6],
                             "Чт": [1, 2, 3, 4, 5, 6, 7], "Пт": [1, 2, 3, 4, 5, 6, 7]}
        },
        "Зевахина": {
            "lessons": [
                {"subject": "Химия", "grade": "8", "hours": 2},
                {"subject": "PRO опыты", "grade": "5", "hours": 1},
                {"subject": "PRO опыты", "grade": "6", "hours": 1},
                {"subject": "PRO опыты", "grade": "7", "hours": 1},
                {"subject": "Биология", "grade": "5", "hours": 2},
                {"subject": "Биология", "grade": "6", "hours": 2},
                {"subject": "Биология", "grade": "7", "hours": 2},
                {"subject": "Биология", "grade": "8", "hours": 2}
            ],
            "availability": {"Пн": [1, 2, 3, 4, 5, 6], "Вт": [1, 2, 3, 4, 5, 6], "Ср": [1, 2, 3, 4, 5, 6],
                             "Чт": [1, 2, 3, 4, 5, 6], "Пт": [1, 2, 3, 4, 5, 6]}
        },
        "Заболотских": {
            "lessons": [
                {"subject": "Русский язык", "grade": "5", "hours": 4},
                {"subject": "Русский язык", "grade": "6", "hours": 4},
                {"subject": "Русский язык", "grade": "7", "hours": 4},
                {"subject": "Русский язык", "grade": "8", "hours": 4},
                {"subject": "Литература", "grade": "5", "hours": 2},
                {"subject": "Литература", "grade": "6", "hours": 2},
                {"subject": "Литература", "grade": "7", "hours": 2},
                {"subject": "Литература", "grade": "8", "hours": 2}
            ],
            "availability": {"Пн": [1, 2, 3, 4, 5, 6, 7], "Вт": [1, 2, 3, 4, 5], "Ср": [1, 2, 3, 4, 5, 6, 7],
                             "Чт": [1, 2, 3, 4, 5], "Пт": [1, 2, 3, 4, 5, 6, 7]}
        },
        "Донская": {
            "lessons": [
                {"subject": "Физика", "grade": "7", "hours": 2},
                {"subject": "Физика", "grade": "8", "hours": 2}
            ],
            "availability": {"Пн": [1, 2, 3, 4, 5, 6, 7], "Вт": [1, 2, 3, 4, 5, 6, 7], "Ср": [1, 2, 3, 4, 5, 6, 7],
                             "Чт": [1, 2, 3, 4, 5, 6, 7], "Пт": [1, 2, 3, 4, 5, 6, 7]}
        }
    }
}


@app.get("/sample-data")
def get_sample_data():
    return SAMPLE_DATA


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)