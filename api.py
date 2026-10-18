from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from typing import List, Optional
import json
import os
from datetime import datetime

# Импорты твоих модулей (убедись, что имена файлов совпадают)
from database import engine, get_db, Base, init_db
from models import User, SavedTimetable
from schemas import UserCreate, UserLogin, TimetableCreate, LessonMoveRequest
from auth import create_access_token, get_current_user, verify_password, get_password_hash
from solver import generate_schedule  # Твой алгоритм генерации
from pdf_generator import generate_pdf_bytes  # Твой генератор PDF
from excel_generator import generate_excel_bytes  # Твой генератор Excel

app = FastAPI(title="School Timetable Generator")

# Настройка CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Монтирование статики
if os.path.exists("static"):
    app.mount("/static", StaticFiles(directory="static"), name="static")


@app.on_event("startup")
def startup_event():
    init_db()
    print("✅ База данных инициализирована")


# --- Аутентификация ---

@app.post("/register")
def register(user: UserCreate, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.email == user.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email уже зарегистрирован")

    hashed_pw = get_password_hash(user.password)
    new_user = User(
        email=user.email,
        full_name=user.full_name,
        school_name=user.school_name,
        hashed_password=hashed_pw
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    token = create_access_token(data={"sub": new_user.email})
    return {
        "access_token": token,
        "token_type": "bearer",
        "user_id": new_user.id,
        "full_name": new_user.full_name
    }


@app.post("/login")
def login(user: UserLogin, db: Session = Depends(get_db)):
    db_user = db.query(User).filter(User.email == user.email).first()
    if not db_user or not verify_password(user.password, db_user.hashed_password):
        raise HTTPException(status_code=401, detail="Неверный email или пароль")

    token = create_access_token(data={"sub": db_user.email})
    return {
        "access_token": token,
        "token_type": "bearer",
        "user_id": db_user.id,
        "full_name": db_user.full_name
    }


# --- Расписания ---

@app.get("/timetables")
def get_timetables(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    timetables = db.query(SavedTimetable).filter(
        SavedTimetable.user_id == current_user.id
    ).order_by(SavedTimetable.created_at.desc()).all()

    result = []
    for t in timetables:
        result.append({
            "id": t.id,
            "name": t.name,
            "created_at": t.created_at.isoformat(),
            "data_preview": str(t.data)[:100] + "..." if t.data else None
        })
    return result


@app.get("/timetables/{timetable_id}")
def get_timetable(timetable_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    timetable = db.query(SavedTimetable).filter(
        SavedTimetable.id == timetable_id,
        SavedTimetable.user_id == current_user.id
    ).first()

    if not timetable:
        raise HTTPException(status_code=404, detail="Расписание не найдено")

    return {"id": timetable.id, "name": timetable.name, "data": timetable.data}


@app.delete("/timetables/{timetable_id}")
def delete_timetable(timetable_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    timetable = db.query(SavedTimetable).filter(
        SavedTimetable.id == timetable_id,
        SavedTimetable.user_id == current_user.id
    ).first()

    if not timetable:
        raise HTTPException(status_code=404, detail="Расписание не найдено")

    db.delete(timetable)
    db.commit()
    return {"message": "Расписание удалено"}


# --- Генерация ---

@app.post("/generate")
def generate(request_data: dict, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        print(f"🚀 Start generation for user {current_user.id}")
        result = generate_schedule(request_data)

        if result.get("status") == "INVALID":
            raise HTTPException(status_code=400, detail=result)

        # Сохраняем в БД
        new_tt = SavedTimetable(
            user_id=current_user.id,
            name=f"Расписание от {datetime.now().strftime('%d.%m %H:%M')}",
            data=result
        )
        db.add(new_tt)
        db.commit()
        db.refresh(new_tt)

        return {"id": new_tt.id, "status": result.get("status"), "solution_time": result.get("solution_time", 0)}

    except Exception as e:
        print(f"❌ Generation error: {e}")
        import traceback;
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# --- Перемещение уроков (ИСПРАВЛЕННАЯ ВЕРСИЯ) ---

@app.post("/timetables/{timetable_id}/move-lesson")
def move_lesson(
        timetable_id: int,
        move_data: dict,
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db)
):
    """Перемещает урок в новое время и проверяет конфликты"""
    try:
        print(f"🔄 MOVE LESSON REQUEST: {move_data}")

        timetable = db.query(SavedTimetable).filter(
            SavedTimetable.id == timetable_id,
            SavedTimetable.user_id == current_user.id
        ).first()

        if not timetable:
            raise HTTPException(status_code=404, detail="Расписание не найдено")

        data = timetable.data
        teachers = data.get('teachers', [])

        # Нормализуем входные данные для поиска
        req_teacher = move_data['teacher'].strip().lower()
        req_subject = move_data['subject'].strip().lower()
        req_grade = str(move_data['grade']).strip()

        # Находим учителя
        target_teacher = None
        for t in teachers:
            if t['teacher'].strip().lower() == req_teacher:
                target_teacher = t
                break

        if not target_teacher:
            raise HTTPException(status_code=404, detail="Учитель не найден в расписании")

        old_schedule = target_teacher.get('schedule', {})
        from_day = move_data['from_day']
        from_slot = str(move_data['from_slot'])

        # --- ШАГ 1: УДАЛЕНИЕ СО СТАРОГО МЕСТА ---
        removed_count = 0
        if from_day in old_schedule and from_slot in old_schedule[from_day]:
            lessons_list = old_schedule[from_day][from_slot]
            new_lessons_list = []

            for l in lessons_list:
                is_same = (
                        l.get('subject', '').strip().lower() == req_subject and
                        str(l.get('grade', '')).strip() == req_grade
                )

                if is_same:
                    removed_count += 1
                    print(f"🗑️ REMOVED: {l['subject']} {l['grade']} from {from_day} slot {from_slot}")
                else:
                    new_lessons_list.append(l)

            old_schedule[from_day][from_slot] = new_lessons_list

            # Чистка пустых структур
            if not new_lessons_list:
                del old_schedule[from_day][from_slot]
                if not old_schedule[from_day]:
                    del old_schedule[from_day]

        print(f"🗑️ Total removed: {removed_count}")

        # --- ШАГ 2: ПРОВЕРКА КОНФЛИКТОВ НА НОВОМ МЕСТЕ ---
        to_day = move_data['to_day']
        to_slot = str(move_data['to_slot'])

        # Конфликт у этого же учителя
        if to_day in old_schedule and to_slot in old_schedule[to_day]:
            raise HTTPException(status_code=409,
                                detail=f"Конфликт: {move_data['teacher']} уже занят в {to_day} на {to_slot} уроке")

        # Конфликт у класса (проверяем ВСЕХ учителей)
        for t in teachers:
            if t['teacher'].strip().lower() == req_teacher: continue

            t_sched = t.get('schedule', {})
            if to_day in t_sched and to_slot in t_sched[to_day]:
                for lesson in t_sched[to_day][to_slot]:
                    if str(lesson.get('grade', '')).strip() == req_grade:
                        raise HTTPException(status_code=409,
                                            detail=f"Конфликт: Класс {req_grade} уже имеет урок в это время у учителя {t['teacher']}")

        # --- ШАГ 3: ДОБАВЛЕНИЕ НА НОВОЕ МЕСТО ---
        if to_day not in old_schedule:
            old_schedule[to_day] = {}
        if to_slot not in old_schedule[to_day]:
            old_schedule[to_day][to_slot] = []

        new_lesson = {
            'subject': move_data['subject'],
            'grade': move_data['grade'],
            'teacher': move_data['teacher'],
            'classroom': move_data.get('classroom', '')
        }

        old_schedule[to_day][to_slot].append(new_lesson)
        print(f"➕ ADDED: {new_lesson['subject']} {new_lesson['grade']} to {to_day} slot {to_slot}")

        timetable.data = data
        db.commit()

        return {"message": "Урок успешно перемещен", "data": data}

    except HTTPException:
        raise
    except Exception as e:
        print(f" CRITICAL ERROR in move_lesson: {e}")
        import traceback;
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Внутренняя ошибка сервера: {str(e)}")


# --- Экспорт ---

@app.get("/timetables/{timetable_id}/export/pdf")
def export_pdf(timetable_id: int, format: str = "teachers", current_user: User = Depends(get_current_user),
               db: Session = Depends(get_db)):
    timetable = db.query(SavedTimetable).filter(
        SavedTimetable.id == timetable_id,
        SavedTimetable.user_id == current_user.id
    ).first()

    if not timetable:
        raise HTTPException(status_code=404, detail="Расписание не найдено")

    pdf_bytes = generate_pdf_bytes(timetable.data, format=format)

    headers = {
        "Content-Disposition": f"attachment; filename=timetable_{timetable_id}_{format}.pdf",
        "Content-Type": "application/pdf"
    }
    from fastapi.responses import Response
    return Response(content=pdf_bytes, headers=headers)


@app.get("/timetables/{timetable_id}/export/excel")
def export_excel(timetable_id: int, format: str = "teachers", current_user: User = Depends(get_current_user),
                 db: Session = Depends(get_db)):
    timetable = db.query(SavedTimetable).filter(
        SavedTimetable.id == timetable_id,
        SavedTimetable.user_id == current_user.id
    ).first()

    if not timetable:
        raise HTTPException(status_code=404, detail="Расписание не найдено")

    excel_bytes = generate_excel_bytes(timetable.data, format=format)

    headers = {
        "Content-Disposition": f"attachment; filename=timetable_{timetable_id}_{format}.xlsx",
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    }
    from fastapi.responses import Response
    return Response(content=excel_bytes, headers=headers)


# --- Главная страница ---

@app.get("/")
def read_root():
    from fastapi.responses import FileResponse
    return FileResponse("static/index.html")