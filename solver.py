from ortools.sat.python import cp_model
from models import TimetableRequest, TimetableResponse, TeacherSchedule, LessonAssignment
from typing import List, Dict, Tuple
from collections import defaultdict


def validate_teachers(request: TimetableRequest) -> Tuple[bool, Dict, List[str]]:
    """Валидация данных учителей перед генерацией"""
    errors = []
    teacher_stats = {}

    for teacher_name, teacher_data in request.teachers.items():
        lessons = teacher_data.lessons
        availability = teacher_data.availability

        if not lessons:
            errors.append(f"Учитель {teacher_name} не имеет предметов")
            continue

        total_hours = sum(lesson.hours for lesson in lessons)
        available_slots = sum(len(slots) for slots in availability.values())

        teacher_stats[teacher_name] = {
            'total_hours': total_hours,
            'available_slots': available_slots,
            'lessons_count': len(lessons)
        }

        if total_hours > available_slots:
            errors.append(
                f"Учитель {teacher_name}: часов ({total_hours}) больше, чем доступных слотов ({available_slots})"
            )

    return len(errors) == 0, teacher_stats, errors


def solve_timetable(request: TimetableRequest) -> TimetableResponse:
    """Генерация расписания с жесткой проверкой кабинетов"""
    model = cp_model.CpModel()

    days = request.days
    slots = request.slots
    teachers = request.teachers

    # Собираем все уроки
    all_lessons = []
    for teacher_name, teacher_data in teachers.items():
        for lesson in teacher_data.lessons:
            for hour_idx in range(lesson.hours):
                all_lessons.append({
                    'teacher': teacher_name,
                    'subject': lesson.subject,
                    'grade': lesson.grade,
                    'classroom': lesson.classroom,
                    'hour_idx': hour_idx
                })

    if not all_lessons:
        return TimetableResponse(
            status="NO_LESSONS",
            solution_time=0,
            teachers=[],
            validation_errors=["Нет уроков для распределения"]
        )

    # Создаем переменные для каждого урока: индекс выбранного слота из possible_slots
    lesson_vars = {}
    for i, lesson in enumerate(all_lessons):
        teacher_name = lesson['teacher']
        availability = teachers[teacher_name].availability

        possible_slots = []
        for day in days:
            if day in availability:
                for slot in slots:
                    if slot in availability[day]:
                        possible_slots.append((day, slot))

        if not possible_slots:
            return TimetableResponse(
                status="NO_SLOTS",
                solution_time=0,
                teachers=[],
                validation_errors=[f"Учитель {teacher_name} не имеет доступных слотов"]
            )

        var = model.NewIntVar(0, len(possible_slots) - 1, f"lesson_{i}")
        lesson_vars[i] = {
            'var': var,
            'lesson': lesson,
            'possible_slots': possible_slots
        }

    # Булевы переменные: lesson_at[i][(day, slot)] == True, если урок i стоит в это время.
    # Это позволяет сравнивать уроки по РЕАЛЬНОМУ (день, урок), а не по индексу в
    # possible_slots — у разных учителей списки доступных слотов различаются,
    # поэтому сравнение индексов давало ложные конфликты.
    lesson_at = {}
    for i, lv in lesson_vars.items():
        for p, (day, slot) in enumerate(lv['possible_slots']):
            b = model.NewBoolVar(f"at_{i}_{day}_{slot}")
            lesson_at[(i, day, slot)] = b
            model.Add(lv['var'] == p).OnlyEnforceIf(b)
            model.Add(lv['var'] != p).OnlyEnforceIf(b.Not())

    # Ограничения 1-3: в один момент времени не более одного урока
    #   - у одного учителя,
    #   - у одного класса,
    #   - в одном кабинете.
    for day in days:
        for slot in slots:
            by_teacher = defaultdict(list)
            by_grade = defaultdict(list)
            by_classroom = defaultdict(list)

            for i, lv in lesson_vars.items():
                b = lesson_at.get((i, day, slot))
                if b is None:
                    continue
                lesson = lv['lesson']
                by_teacher[lesson['teacher']].append(b)
                by_grade[lesson['grade']].append(b)
                if lesson.get('classroom'):
                    by_classroom[lesson['classroom']].append(b)

            for group in (by_teacher, by_grade, by_classroom):
                for _, bools in group.items():
                    if len(bools) > 1:
                        model.AddAtMostOne(bools)

    # Решаем
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 30.0

    status = solver.Solve(model)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        # Формируем конкретные причины, а не общую фразу
        errors = []
        capacity = len(days) * len(slots)

        grade_hours = defaultdict(int)
        for tdata in teachers.values():
            for lesson in tdata.lessons:
                grade_hours[lesson.grade] += lesson.hours
        for grade, hours in grade_hours.items():
            if hours > capacity:
                errors.append(
                    f"Класс {grade}: нагрузка {hours} ч при {capacity} доступных слотах — увеличьте дни/уроки"
                )

        for tname, tdata in teachers.items():
            total = sum(l.hours for l in tdata.lessons)
            avail = sum(len(v) for v in tdata.availability.values())
            if total > avail:
                errors.append(
                    f"Учитель {tname}: нагрузка {total} ч при {avail} доступных слотах"
                )

        if not errors:
            errors.append(
                "Не удалось составить расписание. Проверьте нагрузку, доступность учителей и конфликты кабинетов."
            )

        return TimetableResponse(
            status="INFEASIBLE",
            solution_time=solver.WallTime(),
            teachers=[],
            validation_errors=errors,
        )

    # Собираем результат
    teacher_schedules = {}

    for i, lesson in enumerate(all_lessons):
        teacher_name = lesson['teacher']
        slot_idx = solver.Value(lesson_vars[i]['var'])
        day, slot = lesson_vars[i]['possible_slots'][slot_idx]

        if teacher_name not in teacher_schedules:
            teacher_schedules[teacher_name] = TeacherSchedule(
                teacher=teacher_name,
                total_lessons=0,
                schedule={}
            )

        if day not in teacher_schedules[teacher_name].schedule:
            teacher_schedules[teacher_name].schedule[day] = {}

        if slot not in teacher_schedules[teacher_name].schedule[day]:
            teacher_schedules[teacher_name].schedule[day][slot] = []

        teacher_schedules[teacher_name].schedule[day][slot].append(
            LessonAssignment(
                subject=lesson['subject'],
                grade=lesson['grade'],
                teacher=teacher_name,
                classroom=lesson.get('classroom', '')
            )
        )

        teacher_schedules[teacher_name].total_lessons += 1

    return TimetableResponse(
        status="OPTIMAL" if status == cp_model.OPTIMAL else "FEASIBLE",
        solution_time=solver.WallTime(),
        teachers=list(teacher_schedules.values()),
        validation_errors=[]
    )