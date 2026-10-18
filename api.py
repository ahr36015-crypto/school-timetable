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
from openpyxl import Workbook
from openpyxl.styles import Font, Alignment, Border, Side, PatternFill

# ВАЖНО: Импортируем из правильных мест
from database import init_db, get_db, User, SavedTimetable
from auth import get_password_hash, verify_password, create_access_token, get_current_user
from models import TimetableRequest, TimetableResponse, AIInputRequest
from solver import validate_teachers, solve_timetable
from excel_generator import generate_teachers_excel
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


@app.post("/api/ai-parse")
def ai_parse_text(request: AIInputRequest, current_user: User = Depends(get_current_user)):
    text = request.text.lower().strip()
    result = {"teacher_name": "", "lessons": [], "availability": {}, "max_days": 5}

    name_match = re.search(
        r'^(?:учитель\s+)?([а-яё]+(?:\s+[а-яё\.]+)*?)\s+(?:может|ведет|преподает|работает|проводит|занятия)', text)
    if name_match:
        raw_name = name_match.group(1).strip()
        stop_words = ['может', 'вести', 'урок', 'уроки', 'занятие', 'занятия']
        clean_name_parts = [w for w in raw_name.split() if w.lower() not in stop_words]
        result["teacher_name"] = " ".join(clean_name_parts).title()

    lesson_patterns = [
        r'ведет\s+(?:урок\s+)?([а-яё\s]+?)\s+(?:в\s+)?(\d+(?:-\d+)?)\s*(?:класс|кл)',
        r'преподает\s+([а-яё\s]+?)\s+(\d+(?:-\d+)?)\s*(?:класс|кл)',
    ]
    for pattern in lesson_patterns:
        matches = re.findall(pattern, text)
        for match in matches:
            result["lessons"].append({"subject": match[0].strip().title(), "grade": match[1].strip(), "hours": 2})

    LESSON_TIMES = [
        ("08:30", "09:15"), ("09:25", "10:10"), ("10:20", "11:05"),
        ("11:25", "12:10"), ("12:20", "13:05"), ("13:15", "14:00"),
        ("14:10", "14:55"), ("15:05", "15:50")
    ]

    def get_slots_by_time(start_time_str=None, end_time_str=None):
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
            clean = end_time_str.replace('.', ':').replace('часов', '').replace('ч', '').strip()
            if ':' not in clean: clean += ":00"
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

            if lesson_start >= start_min and lesson_end <= end_min:
                slots.append(i + 1)
        return slots

    days_map = {
        "понедельник": "Понедельник", "вторник": "Вторник", "среда": "Среда",
        "четверг": "Четверг", "пятница": "Пятница", "суббота": "Суббота",
        "каждый день": "ALL"
    }

    found_days = []
    for day_ru, day_norm in days_map.items():
        if day_ru in text:
            if day_ru == "каждый день":
                found_days.extend(["Понедельник", "Вторник", "Среда", "Четверг", "Пятница"])
            else:
                found_days.append(day_norm)

    if found_days:
        slots = []
        range_match = re.search(r'с\s+(\d{1,2}[.:]\d{0,2})\s+до\s+(\d{1,2}[.:]\d{0,2}(?:\s*часов?)?)', text)
        if range_match:
            slots = get_slots_by_time(range_match.group(1), range_match.group(2))
        elif not slots:
            end_match = re.search(r'до\s+(\d{1,2}[.:]\d{0,2}(?:\s*часов?)?)', text)
            if end_match:
                slots = get_slots_by_time(end_time_str=end_match.group(1))
        elif not slots:
            start_match = re.search(r'после\s+(\d{1,2}[.:]\d{0,2}(?:\s*часов?)?)', text)
            if start_match:
                slots = get_slots_by_time(start_time_str=start_match.group(1))

        target_days = set(found_days)
        if slots:
            for d in target_days:
                result["availability"][d] = slots

    if not result["availability"] and ("до" in text or "после" in text or "с" in text):
        slots = []
        range_match = re.search(r'с\s+(\d{1,2}[.:]\d{0,2})\s+до\s+(\d{1,2}[.:]\d{0,2})', text)
        if range_match:
            slots = get_slots_by_time(range_match.group(1), range_match.group(2))
        else:
            end_match = re.search(r'до\s+(\d{1,2}[.:]\d{0,2})', text)
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

        req_teacher = move_data['teacher'].strip().lower()
        req_subject = move_data['subject'].strip().lower()
        req_grade = str(move_data['grade']).strip()

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

            if not new_lessons_list:
                del old_schedule[from_day][from_slot]
                if not old_schedule[from_day]:
                    del old_schedule[from_day]

        print(f"🗑️ Total removed: {removed_count}")

        to_day = move_data['to_day']
        to_slot = str(move_data['to_slot'])

        if to_day in old_schedule and to_slot in old_schedule[to_day]:
            raise HTTPException(status_code=409,
                                detail=f"Конфликт: {move_data['teacher']} уже занят в {to_day} на {to_slot} уроке")

        for t in teachers:
            if t['teacher'].strip().lower() == req_teacher: continue

            t_sched = t.get('schedule', {})
            if to_day in t_sched and to_slot in t_sched[to_day]:
                for lesson in t_sched[to_day][to_slot]:
                    if str(lesson.get('grade', '')).strip() == req_grade:
                        raise HTTPException(status_code=409,
                                            detail=f"Конфликт: Класс {req_grade} уже имеет урок в это время у учителя {t['teacher']}")

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

        for d_key, d_val in old_schedule.items():
            for s_key, s_val in d_val.items():
                seen = set()
                unique_lessons = []
                for lesson in s_val:
                    key = f"{lesson.get('subject', '')}_{lesson.get('grade', '')}_{lesson.get('teacher', '')}"
                    if key not in seen:
                        seen.add(key)
                        unique_lessons.append(lesson)
                    else:
                        print(f" CLEANUP: Removed duplicate {key} at {d_key} {s_key}")
                old_schedule[d_key][s_key] = unique_lessons

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


# ============================================================
# НОВЫЙ ГЕНЕРАТОР EXCEL ПО ШАБЛОНУ (КЛАССЫ В СТОЛБЦАХ)
# ============================================================
def generate_class_template_excel(data):
    wb = Workbook()
    ws = wb.active
    ws.title = "Расписание занятий"

    # Стили
    header_font = Font(bold=True, size=11, color="FFFFFF")
    param_font = Font(bold=True, size=10, color="800080")
    center_align = Alignment(horizontal='center', vertical='center', wrap_text=True)

    purple_fill = PatternFill(start_color="9B59B6", end_color="9B59B6", fill_type="solid")
    thin_border = Border(
        left=Side(style='thin'), right=Side(style='thin'),
        top=Side(style='thin'), bottom=Side(style='thin')
    )

    # 1. Собираем все уникальные классы
    all_grades = set()
    for teacher in data.get('teachers', []):
        for day_schedule in teacher.get('schedule', {}).values():
            for slot_lessons in day_schedule.values():
                for lesson in slot_lessons:
                    if 'grade' in lesson:
                        all_grades.add(str(lesson['grade']))

    sorted_grades = sorted(list(all_grades))
    if not sorted_grades:
        ws.append(["Нет данных о классах"])
        return wb

    days = data.get('days', ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница'])
    slots = data.get('slots', [1, 2, 3, 4, 5, 6, 7])
    times = data.get('lessonTimes', [])

    current_row = 1

    # --- ЗАГОЛОВОК ТАБЛИЦЫ ---
    # Первая колонка пустая (для параметров урока)
    ws.cell(row=current_row, column=1).value = ""

    # Заголовки классов (начинаются со 2-й колонки)
    for col_idx, grade in enumerate(sorted_grades, start=2):
        cell = ws.cell(row=current_row, column=col_idx, value=f"{grade} класс")
        cell.font = header_font
        cell.fill = purple_fill
        cell.alignment = center_align
        cell.border = thin_border

    current_row += 1

    # --- ЦИКЛ ПО ДНЯМ И УРОКАМ ---
    for day in days:
        for slot_idx, slot in enumerate(slots):
            time_str = times[slot_idx] if slot_idx < len(times) else f"Урок {slot}"

            params = [
                ("Предмет", "subject"),
                ("Преподаватель", "teacher"),
                ("Кабинет", "classroom"),
                ("Тема", "topic"),
            ]

            # Строки параметров (Предмет, Учитель...)
            for p_idx, (param_name, param_key) in enumerate(params):
                # Колонка 1: Название параметра
                cell_param = ws.cell(row=current_row + p_idx, column=1, value=param_name)
                cell_param.font = param_font
                cell_param.alignment = center_align
                cell_param.border = thin_border

                # Колонки 2+: Значения для каждого класса
                for col_idx, grade in enumerate(sorted_grades, start=2):
                    val = "-"
                    for t in data.get('teachers', []):
                        sched = t.get('schedule', {})
                        if day in sched and str(slot) in sched[day]:
                            for l in sched[day][str(slot)]:
                                if str(l.get('grade')) == grade:
                                    val = l.get(param_key, "-")
                                    break
                        if val != "-": break

                    cell_val = ws.cell(row=current_row + p_idx, column=col_idx, value=val)
                    cell_val.alignment = center_align
                    cell_val.border = thin_border

            current_row += len(params)

            # Строка "Вычитано" (Время) - теперь в той же первой колонке
            cell_time_label = ws.cell(row=current_row, column=1, value=time_str)
            cell_time_label.font = param_font
            cell_time_label.alignment = center_align
            cell_time_label.border = thin_border

            # Значения вычитанного (если нужны цифры, можно добавить логику, пока прочерк или пусто)
            for col_idx in range(2, len(sorted_grades) + 2):
                cell_val = ws.cell(row=current_row, column=col_idx, value="-")
                cell_val.alignment = center_align
                cell_val.border = thin_border

            current_row += 1

        # Пустая строка между днями
        current_row += 1

    # Автоширина
    for col in ws.columns:
        max_length = 0
        col_letter = col[0].column_letter
        for cell in col:
            try:
                if len(str(cell.value)) > max_length:
                    max_length = len(str(cell.value))
            except:
                pass
        ws.column_dimensions[col_letter].width = max(min(max_length + 2, 50), 10)

    return wb


@app.get("/timetables/{timetable_id}/export/excel")
def export_excel(timetable_id: int, format: str = Query("teachers", regex="^(teachers|classes)$"),
                 current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    timetable = db.query(SavedTimetable).filter(SavedTimetable.id == timetable_id,
                                                SavedTimetable.user_id == current_user.id).first()
    if not timetable: raise HTTPException(status_code=404, detail="Расписание не найдено")

    data = timetable.data
    # Добавляем времена уроков в data для генератора, если их нет
    if 'lessonTimes' not in data:
        data['lessonTimes'] = ["08:30-09:15", "09:25-10:10", "10:20-11:05", "11:25-12:10", "12:20-13:05", "13:15-14:00",
                               "14:10-14:55"]

    if format == "classes":
        # ✅ ИСПОЛЬЗУЕМ НОВЫЙ ГЕНЕРАТОР ПО ШАБЛОНУ
        wb = generate_class_template_excel(data)
        filename = f"raspisanie_{timetable_id}.xlsx"
    else:
        wb = generate_teachers_excel(data, data.get("days"), data.get("slots"))
        filename = f"teachers_{timetable_id}.xlsx"

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