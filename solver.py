from ortools.sat.python import cp_model
from models import TimetableRequest, TimetableResponse, TeacherSchedule, LessonAssignment


def get_classroom(subject: str, grade: str) -> str:
    """Автоматически назначает кабинет на основе предмета"""
    subj_lower = subject.lower()

    # Специализированные кабинеты
    if any(word in subj_lower for word in ['физик', 'астроном']): return '301 (Физика)'
    if any(word in subj_lower for word in ['хим', 'опыт', 'pro опыт']): return '302 (Химия)'
    if any(word in subj_lower for word in ['информатик', 'ит', 'it', 'ai', 'искусственный интеллект', 'старт it']):
        return '205 (Компьютерный класс)'
    if any(word in subj_lower for word in ['спорт', 'физкульт', 'физо']): return 'Спортзал'
    if any(word in subj_lower for word in ['изо', 'технолог', 'труд']): return '104 (Мастерская)'
    if any(word in subj_lower for word in ['музык', 'пение']): return 'Актовый зал'
    if any(word in subj_lower for word in ['биолог', 'эколог']): return '303 (Биология)'

    # Для остальных предметов генерируем кабинет на основе номера класса
    try:
        g_num = int(''.join(filter(str.isdigit, grade.split('-')[0])))
        floor = 1 if g_num <= 4 else 2
        room_num = (g_num * 10) + 1
        return f'{floor}{room_num}'
    except:
        return '101'


def validate_teachers(request: TimetableRequest):
    errors = []
    teacher_stats = []

    for teacher_id, teacher in request.teachers.items():
        total_hours = sum(lesson.hours for lesson in teacher.lessons)
        available_slots = sum(len(slots) for slots in teacher.availability.values())

        teacher_stats.append({
            'teacher': teacher_id,
            'hours': total_hours,
            'slots': available_slots,
            'valid': total_hours <= available_slots
        })

        if total_hours > available_slots:
            deficit = total_hours - available_slots
            errors.append(
                f"{teacher_id}: нагрузка {total_hours}ч превышает доступность {available_slots} слотов (не хватает {deficit})")

    return len(errors) == 0, teacher_stats, errors


def solve_timetable(request: TimetableRequest):
    model = cp_model.CpModel()
    lesson_vars = {}

    # Создаем переменные для каждого урока
    for teacher_id, teacher in request.teachers.items():
        for lesson_idx, lesson in enumerate(teacher.lessons):
            lesson_id = f"{teacher_id}_{lesson.subject}_{lesson.grade}_{lesson_idx}"
            lesson_vars[lesson_id] = {}

            for day in request.days:
                for slot in request.slots:
                    var_name = f"{lesson_id}_{day}_{slot}"
                    var = model.NewBoolVar(var_name)
                    lesson_vars[lesson_id][(day, slot)] = var

    # Ограничение 1: количество часов должно совпадать
    for teacher_id, teacher in request.teachers.items():
        for lesson_idx, lesson in enumerate(teacher.lessons):
            lesson_id = f"{teacher_id}_{lesson.subject}_{lesson.grade}_{lesson_idx}"
            model.Add(
                sum(lesson_vars[lesson_id][(day, slot)]
                    for day in request.days
                    for slot in request.slots)
                == lesson.hours
            )

    # Ограничение 2: учитель не может вести два урока одновременно
    for teacher_id, teacher in request.teachers.items():
        for day in request.days:
            for slot in request.slots:
                teacher_lessons_at_time = []
                for lesson_idx, lesson in enumerate(teacher.lessons):
                    lesson_id = f"{teacher_id}_{lesson.subject}_{lesson.grade}_{lesson_idx}"
                    teacher_lessons_at_time.append(lesson_vars[lesson_id][(day, slot)])

                if teacher_lessons_at_time:
                    model.Add(sum(teacher_lessons_at_time) <= 1)

    # Ограничение 3: доступность учителя
    for teacher_id, teacher in request.teachers.items():
        for lesson_idx, lesson in enumerate(teacher.lessons):
            lesson_id = f"{teacher_id}_{lesson.subject}_{lesson.grade}_{lesson_idx}"

            for day in request.days:
                for slot in request.slots:
                    if slot not in teacher.availability.get(day, []):
                        model.Add(lesson_vars[lesson_id][(day, slot)] == 0)

    # Ограничение 4: класс не может иметь два урока одновременно
    class_lessons = {}
    for teacher_id, teacher in request.teachers.items():
        for lesson_idx, lesson in enumerate(teacher.lessons):
            grade = lesson.grade
            lesson_id = f"{teacher_id}_{lesson.subject}_{lesson.grade}_{lesson_idx}"
            if grade not in class_lessons:
                class_lessons[grade] = []
            class_lessons[grade].append(lesson_id)

    for grade, lesson_ids in class_lessons.items():
        for day in request.days:
            for slot in request.slots:
                class_lessons_at_time = [
                    lesson_vars[lesson_id][(day, slot)]
                    for lesson_id in lesson_ids
                ]
                if class_lessons_at_time:
                    model.Add(sum(class_lessons_at_time) <= 1)

    # Ограничение 5: max_days_per_week
    for teacher_id, teacher in request.teachers.items():
        if teacher.max_days_per_week is not None:
            max_days = teacher.max_days_per_week

            day_vars = {}
            for day in request.days:
                day_var = model.NewBoolVar(f"{teacher_id}_works_{day}")
                day_vars[day] = day_var

                day_lessons = []
                for lesson_idx, lesson in enumerate(teacher.lessons):
                    lesson_id = f"{teacher_id}_{lesson.subject}_{lesson.grade}_{lesson_idx}"
                    for slot in request.slots:
                        day_lessons.append(lesson_vars[lesson_id][(day, slot)])

                if day_lessons:
                    model.Add(sum(day_lessons) > 0).OnlyEnforceIf(day_var)
                    model.Add(sum(day_lessons) == 0).OnlyEnforceIf(day_var.Not())

            model.Add(sum(day_vars.values()) <= max_days)

    # Решение
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 120

    status = solver.Solve(model)

    if status == cp_model.OPTIMAL or status == cp_model.FEASIBLE:
        teachers_result = []

        for teacher_id, teacher in request.teachers.items():
            schedule = {}
            total_lessons = 0

            for lesson_idx, lesson in enumerate(teacher.lessons):
                lesson_id = f"{teacher_id}_{lesson.subject}_{lesson.grade}_{lesson_idx}"

                for day in request.days:
                    for slot in request.slots:
                        if solver.Value(lesson_vars[lesson_id][(day, slot)]) == 1:
                            if day not in schedule:
                                schedule[day] = {}

                            slot_str = str(slot)
                            if slot_str not in schedule[day]:
                                schedule[day][slot_str] = []

                            # Назначаем кабинет при создании урока
                            classroom = get_classroom(lesson.subject, lesson.grade)

                            schedule[day][slot_str].append(
                                LessonAssignment(
                                    subject=lesson.subject,
                                    grade=lesson.grade,
                                    teacher=teacher_id,
                                    classroom=classroom  # <-- Передаем кабинет
                                )
                            )
                            total_lessons += 1

            teachers_result.append(TeacherSchedule(
                teacher=teacher_id,
                schedule=schedule,
                total_lessons=total_lessons
            ))

        return TimetableResponse(
            status=solver.StatusName(status),
            solution_time=solver.WallTime(),
            teachers=teachers_result,
            validation_errors=[]
        )
    else:
        return TimetableResponse(
            status=solver.StatusName(status),
            solution_time=solver.WallTime(),
            teachers=[],
            validation_errors=["Не удалось составить расписание. Проверьте ограничения и доступность учителей."]
        )