import os
import io
import re
from datetime import datetime, timedelta
from typing import Optional, Dict, Any

from fastapi import FastAPI, HTTPException, Depends, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from pydantic import BaseModel

from database import init_db, get_db, User, SavedTimetable
from auth import get_password_hash, verify_password, create_access_token, get_current_user
from models import TimetableRequest, TimetableResponse, AIInputRequest
from solver import validate_teachers, solve_timetable
from excel_generator import generate_teachers_excel, generate_classes_excel
from pdf_generator import generate_teachers_pdf, generate_classes_pdf


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


@app.get("/", response_class=HTMLResponse)
async def read_root():
    index_path = os.path.join("static", "index.html")
    if os.path.exists(index_path):
        with open(index_path, "r", encoding="utf-8") as f:
            return f.read()
    return HTMLResponse(content="<h1>Frontend not found</h1>", status_code=404)


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.post("/register")
def register(user: UserRegister, db: Session = Depends(get_db)):
    db_user = db.query(User).filter(User.email == user.email).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Email уже зарегистрирован")
    new_user = User(email=user.email, hashed_password=get_password_hash(user.password), full_name=user.full_name,
                    school_name=user.school_name)
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    access_token = create_access_token(data={"sub": new_user.id}, expires_delta=timedelta(minutes=10080))
    return {"message": "Регистрация успешна", "user_id": new_user.id, "access_token": access_token,
            "token_type": "bearer", "full_name": new_user.full_name}


@app.post("/login")
def login(user: UserLogin, db: Session = Depends(get_db)):
    db_user = db.query(User).filter(User.email == user.email).first()
    if not db_user or not verify_password(user.password, db_user.hashed_password):
        raise HTTPException(status_code=401, detail="Неверный email или пароль")
    access_token = create_access_token(data={"sub": db_user.id}, expires_delta=timedelta(minutes=10080))
    return {"message": "Вход выполнен успешно", "user_id": db_user.id, "full_name": db_user.full_name,
            "school_name": db_user.school_name, "access_token": access_token, "token_type": "bearer"}


# ============================================================
# УЛУЧШЕННЫЙ AI-ПАРСЕР С ПОДДЕРЖКОЙ ДИАПАЗОНОВ ВРЕМЕНИ
# ============================================================
@app.post("/api/ai-parse")
def ai_parse_text(request: AIInputRequest, current_user: User = Depends(get_current_user)):
    text = request.text.lower()
    result = {"teacher_name": "", "lessons": [], "availability": {}, "max_days": 5}

    # 1. Извлекаем имя
    name_match = re.search(
        r'(?:учитель\s+)?([а-яё]+(?:\s+[а-яё\.]+){1,3})\s+(?:может|ведет|преподает|работает|проводит)', text)
    if name_match:
        raw_name = name_match.group(1).strip()
        result["teacher_name"] = raw_name.title()

    # 2. Извлекаем предметы
    lesson_patterns = [
        r'ведет\s+(?:урок\s+)?([а-яё\s]+?)\s+(?:в\s+)?(\d+(?:-\d+)?)\s*(?:класс|кл)',
        r'преподает\s+([а-яё\s]+?)\s+(\d+(?:-\d+)?)\s*(?:класс|кл)',
    ]
    for pattern in lesson_patterns:
        matches = re.findall(pattern, text)
        for match in matches:
            result["lessons"].append({"subject": match[0].strip().title(), "grade": match[1].strip(), "hours": 2})

    # 3. Сетка времени (стандартная)
    LESSON_TIMES = [
        ("08:30", "09:15"), ("09:25", "10:10"), ("10:20", "11:05"),
        ("11:25", "12:10"), ("12:20", "13:05"), ("13:15", "14:00"),
        ("14:10", "14:55"), ("15:05", "15:50")
    ]

    def get_slots_by_time(start_time_str=None, end_time_str=None):
        """Возвращает номера уроков, попадающих в диапазон [start, end]"""
        slots = []
        start_min = 0
        end_min = 24 * 60

        if start_time_str:
            clean = start_time_str.replace('.', ':').strip()
            parts = clean.split(':')
            if len(parts) == 2:
                try:
                    start_min = int(parts[0]) * 60 + int(parts[1])
                except:
                    pass

        if end_time_str:
            clean = end_time_str.replace('.', ':').strip()
            parts = clean.split(':')
            if len(parts) == 2:
                try:
                    end_min = int(parts[0]) * 60 + int(parts[1])
                except:
                    pass

        for i, (s, e) in enumerate(LESSON_TIMES):
            s_parts = s.split(':');
            e_parts = e.split(':')
            lesson_start = int(s_parts[0]) * 60 + int(s_parts[1])
            lesson_end = int(e_parts[0]) * 60 + int(e_parts[1])

            # Урок подходит, если он начинается >= start и заканчивается <= end
            if lesson_start >= start_min and lesson_end <= end_min:
                slots.append(i + 1)
        return slots

    days_map = {
        "понедельник": "Понедельник", "вторник": "Вторник", "среда": "Среда",
        "четверг": "Четверг", "пятница": "Пятница", "суббота": "Суббота",
        "каждый день": "ALL"
    }

    # Ищем дни недели в тексте
    found_days = []
    for day_ru, day_norm in days_map.items():
        if day_ru in text:
            if day_ru == "каждый день":
                found_days.extend(["Понедельник", "Вторник", "Среда", "Четверг", "Пятница"])
            else:
                found_days.append(day_norm)

    # Если дни найдены, ищем время относительно них
    if found_days:
        slots = []

        # 1. Диапазон "с X до Y"
        range_match = re.search(r'с\s+(\d{1,2}[.:]\d{2})\s+до\s+(\d{1,2}[.:]\d{2}(?:\s*часов)?)', text)
        if range_match:
            slots = get_slots_by_time(range_match.group(1), range_match.group(2))

        # 2. Только "до X"
        elif not slots:
            end_match = re.search(r'до\s+(\d{1,2}[.:]\d{2}(?:\s*часов)?)', text)
            if end_match:
                slots = get_slots_by_time(end_time_str=end_match.group(1))

        # 3. Только "после X"
        elif not slots:
            start_match = re.search(r'после\s+(\d{1,2}[.:]\d{2}(?:\s*часов)?)', text)
            if start_match:
                slots = get_slots_by_time(start_time_str=start_match.group(1))

        # Записываем найденные слоты для всех найденных дней
        if slots:
            for d in set(found_days):
                result["availability"][d] = slots

    # Fallback: если дней нет, но есть время - применяем ко всем будням
    if not result["availability"] and ("до" in text or "после" in text or "с" in text):
        slots = []
        range_match = re.search(r'с\s+(\d{1,2}[.:]\d{2})\s+до\s+(\d{1,2}[.:]\d{2})', text)
        if range_match:
            slots = get_slots_by_time(range_match.group(1), range_match.group(2))
        else:
            end_match = re.search(r'до\s+(\d{1,2}[.:]\d{2})', text)
            if end_match: slots = get_slots_by_time(end_time_str=end_match.group(1))

        if slots:
            for d in ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница"]:
                result["availability"][d] = slots

    return result


def response_to_dict(result: TimetableResponse, request: TimetableRequest) -> Dict[str, Any]:
    return {
        "status": result.status, "solution_time": result.solution_time, "days": request.days, "slots": request.slots,
        "teachers": [{
            "teacher": t.teacher, "total_lessons": t.total_lessons,
            "schedule": {day: {
                str(slot): [{"subject": a.subject, "grade": a.grade, "teacher": a.teacher, "classroom": a.classroom} for
                            a in assignments] for slot, assignments in slots.items()} for day, slots in
                         t.schedule.items()}
        } for t in result.teachers],
        "validation_errors": result.validation_errors
    }


@app.post("/generate")
def generate_timetable(request: TimetableRequest, current_user: User = Depends(get_current_user),
                       db: Session = Depends(get_db)):
    try:
        print(f" НАЧАЛО ГЕНЕРАЦИИ для пользователя {current_user.id}")
        print(f" Данные: {len(request.teachers)} учителей, {len(request.days)} дней, {len(request.slots)} слотов")

        is_valid, teacher_stats, errors = validate_teachers(request)
        if not is_valid:
            return {"message": "Ошибки валидации", "status": "INVALID", "errors": errors,
                    "teacher_stats": teacher_stats}

        print("⚙️ Запускаю OR-Tools solver...")
        result: TimetableResponse = solve_timetable(request)
        print(f"✅ Solver завершил работу. Статус: {result.status}")

        if result.status not in ("OPTIMAL", "FEASIBLE"):
            return {"message": "Не удалось составить расписание", "status": result.status,
                    "solution_time": result.solution_time,
                    "validation_errors": result.validation_errors or ["Проверьте ограничения"]}

        data_dict = response_to_dict(result, request)
        saved = SavedTimetable(
            user_id=current_user.id,
            name=f"Расписание {datetime.utcnow().strftime('%d.%m.%Y %H:%M')}",
            data=data_dict,
        )
        db.add(saved)
        db.commit()
        db.refresh(saved)
        print(f"💾 Расписание сохранено с ID: {saved.id}")

        return {"message": "Расписание сгенерировано", "id": saved.id, "status": result.status,
                "solution_time": result.solution_time, "validation_errors": result.validation_errors}
    except Exception as e:
        print(f"❌ КРИТИЧЕСКАЯ ОШИБКА ГЕНЕРАЦИИ: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Ошибка генерации: {str(e)}")


@app.get("/timetables")
def get_timetables(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        timetables = db.query(SavedTimetable).filter(SavedTimetable.user_id == current_user.id).order_by(
            SavedTimetable.created_at.desc()).all()
        return [{"id": t.id, "name": t.name, "created_at": t.created_at.isoformat() if t.created_at else None,
                 "data": t.data if t.data else {}} for t in timetables]
    except Exception as e:
        print(f"❌ Ошибка получения расписаний: {e}");
        return []


@app.get("/timetables/{timetable_id}")
def get_timetable(timetable_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        timetable = db.query(SavedTimetable).filter(SavedTimetable.id == timetable_id,
                                                    SavedTimetable.user_id == current_user.id).first()
        if not timetable: raise HTTPException(status_code=404, detail="Расписание не найдено")
        return {"id": timetable.id, "name": timetable.name,
                "created_at": timetable.created_at.isoformat() if timetable.created_at else None,
                "data": timetable.data if timetable.data else {}}
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Ошибка получения расписания {timetable_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Ошибка: {str(e)}")


@app.put("/timetables/{timetable_id}")
def update_timetable(timetable_id: int, update_data: TimetableUpdate, current_user: User = Depends(get_current_user),
                     db: Session = Depends(get_db)):
    timetable = db.query(SavedTimetable).filter(SavedTimetable.id == timetable_id,
                                                SavedTimetable.user_id == current_user.id).first()
    if not timetable: raise HTTPException(status_code=404, detail="Расписание не найдено")
    if update_data.name is not None: timetable.name = update_data.name
    if update_data.data is not None: timetable.data = update_data.data
    db.commit();
    db.refresh(timetable)
    return {"message": "Расписание обновлено", "id": timetable.id, "name": timetable.name}


@app.delete("/timetables/{timetable_id}")
def delete_timetable(timetable_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    timetable = db.query(SavedTimetable).filter(SavedTimetable.id == timetable_id,
                                                SavedTimetable.user_id == current_user.id).first()
    if not timetable: raise HTTPException(status_code=404, detail="Расписание не найдено")
    db.delete(timetable);
    db.commit()
    return {"message": "Расписание удалено"}


@app.get("/timetables/{timetable_id}/master-view")
def get_master_view(
        timetable_id: int,
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db)
):
    """Возвращает расписание в формате: День -> Урок -> {Класс: {subject, teacher, classroom}}"""
    timetable = db.query(SavedTimetable).filter(
        SavedTimetable.id == timetable_id,
        SavedTimetable.user_id == current_user.id
    ).first()

    if not timetable:
        raise HTTPException(status_code=404, detail="Расписание не найдено")

    data = timetable.data
    days = data.get("days", [])
    slots = data.get("slots", [])
    teachers = data.get("teachers", [])

    master_schedule = {}

    for day in days:
        master_schedule[day] = {}
        for slot in slots:
            slot_str = str(slot)
            master_schedule[day][slot_str] = {}

            for t in teachers:
                t_sched = t.get('schedule', {})
                if day in t_sched and slot_str in t_sched[day]:
                    for lesson in t_sched[day][slot_str]:
                        grade = lesson['grade']
                        master_schedule[day][slot_str][grade] = {
                            'subject': lesson['subject'],
                            'teacher': lesson['teacher'],
                            'classroom': lesson.get('classroom', '')
                        }

    return {
        "days": days,
        "slots": slots,
        "schedule": master_schedule
    }


@app.post("/timetables/{timetable_id}/move-lesson")
def move_lesson(
        timetable_id: int,
        move_data: dict,
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db)
):
    """Перемещает урок в новое время и проверяет конфликты"""
    try:
        timetable = db.query(SavedTimetable).filter(
            SavedTimetable.id == timetable_id,
            SavedTimetable.user_id == current_user.id
        ).first()

        if not timetable:
            raise HTTPException(status_code=404, detail="Расписание не найдено")

        data = timetable.data
        teachers = data.get('teachers', [])

        target_teacher = None
        for t in teachers:
            if t['teacher'] == move_data['teacher']:
                target_teacher = t
                break

        if not target_teacher:
            raise HTTPException(status_code=404, detail="Учитель не найден в расписании")

        old_schedule = target_teacher.get('schedule', {})
        from_day = move_data['from_day']
        from_slot = str(move_data['from_slot'])

        if from_day in old_schedule and from_slot in old_schedule[from_day]:
            lessons_list = old_schedule[from_day][from_slot]
            new_lessons_list = [
                l for l in lessons_list
                if not (l['subject'] == move_data['subject'] and l['grade'] == move_data['grade'])
            ]
            if new_lessons_list:
                old_schedule[from_day][from_slot] = new_lessons_list
            else:
                del old_schedule[from_day][from_slot]
                if not old_schedule[from_day]:
                    del old_schedule[from_day]

        to_day = move_data['to_day']
        to_slot = str(move_data['to_slot'])

        if to_day in old_schedule and to_slot in old_schedule[to_day]:
            raise HTTPException(status_code=409,
                                detail=f"Конфликт: {move_data['teacher']} уже занят в {to_day} на {to_slot} уроке")

        for t in teachers:
            if t['teacher'] == move_data['teacher']: continue
            t_sched = t.get('schedule', {})
            if to_day in t_sched and to_slot in t_sched[to_day]:
                for lesson in t_sched[to_day][to_slot]:
                    if lesson['grade'] == move_data['grade']:
                        raise HTTPException(status_code=409,
                                            detail=f"Конфликт: Класс {move_data['grade']} уже имеет урок в это время у учителя {t['teacher']}")

        if to_day not in old_schedule:
            old_schedule[to_day] = {}
        if to_slot not in old_schedule[to_day]:
            old_schedule[to_day][to_slot] = []

        old_schedule[to_day][to_slot].append({
            'subject': move_data['subject'],
            'grade': move_data['grade'],
            'teacher': move_data['teacher'],
            'classroom': move_data.get('classroom', '')
        })

        timetable.data = data
        db.commit()

        return {"message": "Урок успешно перемещен", "data": data}

    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Ошибка при перемещении урока: {e}")
        import traceback;
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Внутренняя ошибка сервера: {str(e)}")


@app.get("/timetables/{timetable_id}/export/excel")
def export_excel(timetable_id: int, format: str = Query("teachers", regex="^(teachers|classes)$"),
                 current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    timetable = db.query(SavedTimetable).filter(SavedTimetable.id == timetable_id,
                                                SavedTimetable.user_id == current_user.id).first()
    if not timetable: raise HTTPException(status_code=404, detail="Расписание не найдено")
    data = timetable.data
    days = data.get("days", ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница"])
    slots = data.get("slots", [1, 2, 3, 4, 5, 6, 7])
    if format == "teachers":
        wb = generate_teachers_excel(data, days, slots);
        filename = f"timetable_teachers_{timetable_id}.xlsx"
    else:
        wb = generate_classes_excel(data, days, slots);
        filename = f"timetable_classes_{timetable_id}.xlsx"
    output = io.BytesIO();
    wb.save(output);
    output.seek(0)
    return StreamingResponse(output, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": f"attachment; filename={filename}"})


@app.get("/timetables/{timetable_id}/export/pdf")
def export_pdf(timetable_id: int, format: str = Query("teachers", regex="^(teachers|classes)$"),
               current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    timetable = db.query(SavedTimetable).filter(SavedTimetable.id == timetable_id,
                                                SavedTimetable.user_id == current_user.id).first()
    if not timetable: raise HTTPException(status_code=404, detail="Расписание не найдено")
    data = timetable.data
    days = data.get("days", ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница"])
    slots = data.get("slots", [1, 2, 3, 4, 5, 6, 7])
    if format == "teachers":
        pdf_bytes = generate_teachers_pdf(data, days, slots);
        filename = f"timetable_teachers_{timetable_id}.pdf"
    else:
        pdf_bytes = generate_classes_pdf(data, days, slots);
        filename = f"timetable_classes_{timetable_id}.pdf"
    return StreamingResponse(io.BytesIO(pdf_bytes), media_type="application/pdf",
                             headers={"Content-Disposition": f"attachment; filename={filename}"})