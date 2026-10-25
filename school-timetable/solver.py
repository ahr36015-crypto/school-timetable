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

    # Ограничение 1: Один учитель не может вести два урока одновременно
    for i in range(len(all_lessons)):
        for j in range(i + 1, len(all_lessons)):
            if all_lessons[i]['teacher'] == all_lessons[j]['teacher']:
                model.Add(lesson_vars[i]['var'] != lesson_vars[j]['var'])

    # Ограничение 2: Один класс не может иметь два урока одновременно
    for i in range(len(all_lessons)):
        for j in range(i + 1, len(all_lessons)):
            if all_lessons[i]['grade'] == all_lessons[j]['grade']:
                model.Add(lesson_vars[i]['var'] != lesson_vars[j]['var'])

    # Ограничение 3: 🔥 ЖЕСТКАЯ ПРОВЕРКА КАБИНЕТОВ 🔥
    # Один кабинет не может быть занят двумя разными уроками в одно и то же время
    classroom_lesson_indices = defaultdict(list)
    for i, lesson in enumerate(all_lessons):
        if lesson.get('classroom'):
            classroom_lesson_indices[lesson['classroom']].append(i)

    for classroom, indices in classroom_lesson_indices.items():
        # Для каждой пары уроков, требующих один кабинет
        for d in range(len(indices)):
            for e in range(d + 1, len(indices)):
                idx_i = indices[d]
                idx_j = indices[e]

                # Проверяем каждый возможный слот
                for day in days:
                    for slot in slots:
                        # Если оба урока МОГУТ быть поставлены на этот слот
                        pos_i = None
                        pos_j = None

                        for p, (d_i, s_i) in enumerate(lesson_vars[idx_i]['possible_slots']):
                            if d_i == day and s_i == slot:
                                pos_i = p
                                break

                        for p, (d_j, s_j) in enumerate(lesson_vars[idx_j]['possible_slots']):
                            if d_j == day and s_j == slot:
                                pos_j = p
                                break

                        # Если оба могут быть на этом слоте - запрещаем
                        if pos_i is not None and pos_j is not None:
                            # Создаем булевы переменные для каждого урока
                            b_i = model.NewBoolVar(f'b_{idx_i}_{day}_{slot}')
                            b_j = model.NewBoolVar(f'b_{idx_j}_{day}_{slot}')

                            # Связываем их с основными переменными
                            model.Add(lesson_vars[idx_i]['var'] == pos_i).OnlyEnforceIf(b_i)
                            model.Add(lesson_vars[idx_i]['var'] != pos_i).OnlyEnforceIf(b_i.Not())

                            model.Add(lesson_vars[idx_j]['var'] == pos_j).OnlyEnforceIf(b_j)
                            model.Add(lesson_vars[idx_j]['var'] != pos_j).OnlyEnforceIf(b_j.Not())

                            # Запрещаем обоим быть True одновременно
                            model.AddAtMostOne(b_i, b_j)

    # Решаем
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 30.0

    status = solver.Solve(model)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return TimetableResponse(
            status="INFEASIBLE",
            solution_time=solver.WallTime(),
            teachers=[],
            validation_errors=[
                "Не удалось составить расписание. Проверьте нагрузку, доступность учителей и конфликты кабинетов."]
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