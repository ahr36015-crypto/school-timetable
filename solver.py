import re
from ortools.sat.python import cp_model
from models import (
    TimetableRequest, TimetableResponse, TeacherSchedule, LessonAssignment,
    CombinedLesson,
)
from typing import List, Dict, Tuple, Set, Optional
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

    # Собираем занятия. Часы кратны 0.5; каждое «полное» занятие = 2 единицы,
    # «половинка» = 1 единица. Вместимость одного слота — 2 единицы.
    all_lessons = []
    for teacher_name, teacher_data in teachers.items():
        for lesson in teacher_data.lessons:
            week_index = getattr(lesson, "week_index", None)
            units_left = max(1, int(round(float(lesson.hours) * 2)))
            while units_left > 0:
                chunk = 2 if units_left >= 2 else 1
                all_lessons.append({
                    "teacher": teacher_name,
                    "subject": lesson.subject,
                    "grade": lesson.grade,
                    "classroom": lesson.classroom,
                    "week_index": week_index,
                    "units": chunk,
                })
                units_left -= chunk

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

    # ================================================================
    # СОВМЕЩЁННЫЕ УРОКИ
    # ================================================================
    # Для каждого правила combined_lessons сопоставляем чанки уроков с
    # одинаковым учителем и предметом.  Все чанки группы получают
    # constraint: их IntVar-ы равны => один и тот же слот.
    # Также заполняем lesson_meta для выдачи результата.
    lesson_meta: Dict[int, Dict[str, Any]] = {}
    combined_groups: List[List[int]] = []
    combined_chunk_indices: Set[int] = set()

    cl_rules = getattr(request, "combined_lessons", None) or []
    for rule in cl_rules:
        cls_list = [str(c).strip() for c in rule.classes]
        if len(cls_list) < 2:
            continue
        rule_teacher = str(rule.teacher).strip()
        rule_subject = str(rule.subject).strip()
        rule_wi = getattr(rule, "week_index", None)
        rule_hours = float(rule.hours or 0)

        # Проверяем, есть ли учитель в расписании
        if rule_teacher not in teachers:
            continue

        # Находим все чанки этого учителя с данным предметом/неделёй
        matched_indices: List[int] = []
        for i, lesson in enumerate(all_lessons):
            if (
                lesson["teacher"] == rule_teacher
                and lesson["subject"] == rule_subject
                and _weeks_active(getattr(lesson, "week_index", None))
                    == _weeks_active(rule_wi)
                and abs(float(lesson.get("units", 2)) - int(round(float(rule_hours) * 2))) <= 0
            ):
                # Чанк подходит — проверяем что его grade входит в правило
                grade_str = str(lesson.get("grade", "")).strip()
                if grade_str in cls_list:
                    matched_indices.append(i)

        if len(matched_indices) >= 2:
            # Создаём group_id и ставим равенство индексов слотов
            group_id = f"{rule_teacher}|{rule_subject}|{'-'.join(cls_list)}"
            for idx in matched_indices:
                lesson_meta[idx] = {
                    "combined_group_id": group_id,
                    "classes_in_group": cls_list,
                }
                combined_chunk_indices.add(idx)
            combined_groups.append(matched_indices)
            # Constraint: все переменные выбирают одинаковый индекс слота
            for a in range(len(matched_indices) - 1):
                i_a = matched_indices[a]
                i_b = matched_indices[a + 1]
                model.Add(lesson_vars[i_a]["var"] == lesson_vars[i_b]["var"])

    # Добавляем penalty за «дыры» только для классов БЕЗ комбинирования
    # (для комбинированных классов дыры считаются по общему учителю)
    # 
    # ВАЖНО: combined-group чанки НЕ участвуют в teacher-constraint,
    # потому что они принудительно равны через Equal и должны занимать
    # один слот для одного учителя. Иначе constraint sum(units*b)<=2
    # блокирует их (2+2 > 2). Классовые constraint оставляем как есть.

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
                entry = (b, lesson.get("week_index"), lesson.get("units", 2))
                # Combined-group chunks skip teacher constraint — they're
                # forced equal and represent ONE physical lesson for the
                # teacher, not multiple independent lessons.
                if i not in combined_chunk_indices:
                    by_teacher[lesson["teacher"]].append(entry)
                by_grade[lesson["grade"]].append(entry)
                if lesson.get("classroom"):
                    by_classroom[lesson["classroom"]].append(entry)

            for group in (by_teacher, by_grade, by_classroom):
                for _, entries in group.items():
                    for week in range(CYCLE_WEEKS):
                        active = [(b, u) for (b, wi, u) in entries if wi is None or wi == week]
                        if len(active) > 1:
                            # вместимость слота = 2 половинки (1 полная пара)
                            model.Add(sum(u * b for (b, u) in active) <= 2)

    # Мягкая цель: минимизировать «дыры» в расписании классов и учителей.
    # Для каждой группы (класс или учитель, день, урок) считаем present, затем
    # число «начал» блоков занятий: start[s] = present[s] и не present[s-1].
    # Минимизация числа starts уплотняет занятия с первого урока.
    def _gap_penalties(group_map, prefix):
        terms = []
        for key, idxs in group_map.items():
            safe_key = re.sub(r"[^0-9A-Za-zА-Яа-я_]+", "_", str(key))[:40]
            for day in days:
                day_safe = re.sub(r"[^0-9A-Za-zА-Яа-я_]+", "_", str(day))[:20]
                present = {}
                for slot in slots:
                    bools = [lesson_at[(i, day, slot)] for i in idxs if (i, day, slot) in lesson_at]
                    if not bools:
                        present[slot] = None
                        continue
                    p = model.NewBoolVar(f"pres_{prefix}_{safe_key}_{day_safe}_{slot}")
                    for b in bools:
                        model.Add(p >= b)
                    model.Add(p <= sum(bools))
                    present[slot] = p

                for k in range(1, len(slots)):
                    slot = slots[k]
                    prev = slots[k - 1]
                    pc = present.get(slot)
                    if pc is None:
                        continue
                    start = model.NewBoolVar(f"start_{prefix}_{safe_key}_{day_safe}_{slot}")
                    pp = present.get(prev)
                    if pp is None:
                        model.Add(start >= pc)
                    else:
                        model.Add(start >= pc - pp)
                    terms.append(start)
        return terms

    grade_lessons = defaultdict(list)
    teacher_lessons = defaultdict(list)
    for i, lv in lesson_vars.items():
        grade_lessons[lv["lesson"]["grade"]].append(i)
        teacher_lessons[lv["lesson"]["teacher"]].append(i)

    gap_terms = _gap_penalties(grade_lessons, "g") + _gap_penalties(teacher_lessons, "t")

    # Дополнительно тянем занятия в ранние дни и ранние уроки — это уплотняет
    # расписание (урок за уроком) и убирает пустые «окна» внутри дня.
    day_pos = {d: i for i, d in enumerate(days)}
    slot_pos = {s: i for i, s in enumerate(slots)}
    pos_terms = []
    for i, lv in lesson_vars.items():
        for (day, slot) in lv["possible_slots"]:
            pos_terms.append(lesson_at[(i, day, slot)] * (day_pos[day] * (len(slots) + 1) + slot_pos[slot]))

    objective = [t * 100 for t in gap_terms] + pos_terms
    if objective:
        model.Minimize(sum(objective))

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

        meta = lesson_meta.get(i, {})
        teacher_schedules[teacher_name].schedule[day][slot].append(
            LessonAssignment(
                subject=lesson["subject"],
                grade=lesson["grade"],
                teacher=teacher_name,
                classroom=lesson.get("classroom", ""),
                week_index=lesson.get("week_index"),
                half=(lesson.get("units") == 1),
                combined_group_id=meta.get("combined_group_id"),
            )
        )

        teacher_schedules[teacher_name].total_lessons += 1

    return TimetableResponse(
        status="OPTIMAL" if status == cp_model.OPTIMAL else "FEASIBLE",
        solution_time=solver.WallTime(),
        teachers=list(teacher_schedules.values()),
        validation_errors=[],
    )
