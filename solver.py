from ortools.sat.python import cp_model
from models import TimetableRequest, TimetableResponse, TeacherSchedule, LessonAssignment
from typing import List, Dict, Tuple
from collections import defaultdict

# Двухнедельный цикл: недели 0 (синяя) и 1 (красная)
CYCLE_WEEKS = 2


def _weeks_active(week_index):
    """Множество недель цикла, в которые бывает занятие.

    None -> каждая неделя; 0 -> только синяя; 1 -> только красная.
    """
    if week_index is None:
        return {0, 1}
    return {0 if week_index == 0 else 1}


def validate_teachers(request: TimetableRequest) -> Tuple[bool, Dict, List[str]]:
    """Валидация данных учителей перед генерацией (с учётом чётности недель)."""
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

        per_week = {0: 0, 1: 0}
        for lesson in lessons:
            for w in _weeks_active(getattr(lesson, "week_index", None)):
                per_week[w] += lesson.hours

        teacher_stats[teacher_name] = {
            "total_hours": total_hours,
            "available_slots": available_slots,
            "lessons_count": len(lessons),
            "per_week_hours": per_week,
        }

        worst_week = max(per_week[0], per_week[1])
        if worst_week > available_slots:
            errors.append(
                f"Учитель {teacher_name}: в одну из недель нужно {worst_week} ч, "
                f"а доступно слотов {available_slots}"
            )

    return len(errors) == 0, teacher_stats, errors


def solve_timetable(request: TimetableRequest) -> TimetableResponse:
    """Генерация расписания с учётом чётности недель и кабинетов."""
    model = cp_model.CpModel()

    days = request.days
    slots = request.slots
    teachers = request.teachers

    # Собираем все уроки (с признаком чётности недели)
    all_lessons = []
    for teacher_name, teacher_data in teachers.items():
        for lesson in teacher_data.lessons:
            week_index = getattr(lesson, "week_index", None)
            for hour_idx in range(lesson.hours):
                all_lessons.append({
                    "teacher": teacher_name,
                    "subject": lesson.subject,
                    "grade": lesson.grade,
                    "classroom": lesson.classroom,
                    "week_index": week_index,
                    "hour_idx": hour_idx,
                })

    if not all_lessons:
        return TimetableResponse(
            status="NO_LESSONS",
            solution_time=0,
            teachers=[],
            validation_errors=["Нет уроков для распределения"],
        )

    # Переменные: индекс выбранного слота из possible_slots
    lesson_vars = {}
    for i, lesson in enumerate(all_lessons):
        teacher_name = lesson["teacher"]
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
                validation_errors=[f"Учитель {teacher_name} не имеет доступных слотов"],
            )

        var = model.NewIntVar(0, len(possible_slots) - 1, f"lesson_{i}")
        lesson_vars[i] = {
            "var": var,
            "lesson": lesson,
            "possible_slots": possible_slots,
        }

    # Булевы переменные: урок i стоит в (day, slot)
    lesson_at = {}
    for i, lv in lesson_vars.items():
        for p, (day, slot) in enumerate(lv["possible_slots"]):
            b = model.NewBoolVar(f"at_{i}_{day}_{slot}")
            lesson_at[(i, day, slot)] = b
            model.Add(lv["var"] == p).OnlyEnforceIf(b)
            model.Add(lv["var"] != p).OnlyEnforceIf(b.Not())

    # Ограничения по каждой неделе цикла отдельно:
    # в один момент времени у учителя/класса/кабинета — не более одного урока.
    # Занятия из разных недель цикла могут делить один и тот же слот.
    for day in days:
        for slot in slots:
            by_teacher = defaultdict(list)
            by_grade = defaultdict(list)
            by_classroom = defaultdict(list)

            for i, lv in lesson_vars.items():
                b = lesson_at.get((i, day, slot))
                if b is None:
                    continue
                lesson = lv["lesson"]
                entry = (b, lesson.get("week_index"))
                by_teacher[lesson["teacher"]].append(entry)
                by_grade[lesson["grade"]].append(entry)
                if lesson.get("classroom"):
                    by_classroom[lesson["classroom"]].append(entry)

            for group in (by_teacher, by_grade, by_classroom):
                for _, entries in group.items():
                    for week in range(CYCLE_WEEKS):
                        active = [b for (b, wi) in entries if wi is None or wi == week]
                        if len(active) > 1:
                            model.AddAtMostOne(active)

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 30.0

    status = solver.Solve(model)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        errors = []
        capacity = len(days) * len(slots)

        grade_hours = {0: defaultdict(int), 1: defaultdict(int)}
        for tdata in teachers.values():
            for lesson in tdata.lessons:
                for w in _weeks_active(getattr(lesson, "week_index", None)):
                    grade_hours[w][lesson.grade] += lesson.hours
        for w in range(CYCLE_WEEKS):
            for grade, hours in grade_hours[w].items():
                if hours > capacity:
                    errors.append(
                        f"Класс {grade}: в одну из недель нагрузка {hours} ч при {capacity} доступных слотах"
                    )

        for tname, tdata in teachers.items():
            per_week = {0: 0, 1: 0}
            for lesson in tdata.lessons:
                for w in _weeks_active(getattr(lesson, "week_index", None)):
                    per_week[w] += lesson.hours
            avail = sum(len(v) for v in tdata.availability.values())
            worst = max(per_week[0], per_week[1])
            if worst > avail:
                errors.append(
                    f"Учитель {tname}: в одну из недель нужно {worst} ч при {avail} доступных слотах"
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
        teacher_name = lesson["teacher"]
        slot_idx = solver.Value(lesson_vars[i]["var"])
        day, slot = lesson_vars[i]["possible_slots"][slot_idx]

        if teacher_name not in teacher_schedules:
            teacher_schedules[teacher_name] = TeacherSchedule(
                teacher=teacher_name,
                total_lessons=0,
                schedule={},
            )

        if day not in teacher_schedules[teacher_name].schedule:
            teacher_schedules[teacher_name].schedule[day] = {}

        if slot not in teacher_schedules[teacher_name].schedule[day]:
            teacher_schedules[teacher_name].schedule[day][slot] = []

        teacher_schedules[teacher_name].schedule[day][slot].append(
            LessonAssignment(
                subject=lesson["subject"],
                grade=lesson["grade"],
                teacher=teacher_name,
                classroom=lesson.get("classroom", ""),
                week_index=lesson.get("week_index"),
            )
        )

        teacher_schedules[teacher_name].total_lessons += 1

    return TimetableResponse(
        status="OPTIMAL" if status == cp_model.OPTIMAL else "FEASIBLE",
        solution_time=solver.WallTime(),
        teachers=list(teacher_schedules.values()),
        validation_errors=[],
    )
