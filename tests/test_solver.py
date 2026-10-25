"""Тесты решателя: расписание строится без конфликтов."""
from models import Lesson, Teacher, TimetableRequest
from solver import solve_timetable

DAYS = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница"]
SLOTS = [1, 2, 3, 4, 5, 6, 7]


def test_solver_produces_conflict_free_schedule():
    full = {d: list(SLOTS) for d in DAYS}
    request = TimetableRequest(
        days=DAYS,
        slots=SLOTS,
        teachers={
            "Иванова": Teacher(lessons=[
                Lesson(subject="Математика", grade="5A", hours=3),
                Lesson(subject="Математика", grade="5B", hours=3),
            ], availability=full),
            # другой набор доступности — раньше ломал индексную логику ограничений
            "Петров": Teacher(lessons=[
                Lesson(subject="Русский", grade="5A", hours=3),
                Lesson(subject="Русский", grade="5B", hours=3),
            ], availability={d: [1, 2, 3, 4] for d in DAYS}),
            "Сидоров": Teacher(lessons=[
                Lesson(subject="Физика", grade="6A", hours=2, classroom="101"),
                Lesson(subject="Физика", grade="6B", hours=2, classroom="101"),
            ], availability=full),
        },
        lessonTimes=[],
    )

    result = solve_timetable(request)
    assert result.status in ("OPTIMAL", "FEASIBLE")

    teacher_slot, grade_slot, classroom_slot = {}, {}, {}
    total = 0
    for t in result.teachers:
        for day, slots in t.schedule.items():
            for slot, lessons in slots.items():
                key = (day, slot)
                for l in lessons:
                    total += 1
                    assert (t.teacher, key) not in teacher_slot, f"Учитель занят дважды: {t.teacher} {key}"
                    teacher_slot[(t.teacher, key)] = l.subject
                    assert (l.grade, key) not in grade_slot, f"Класс занят дважды: {l.grade} {key}"
                    grade_slot[(l.grade, key)] = t.teacher
                    if l.classroom:
                        assert (l.classroom, key) not in classroom_slot, f"Кабинет занят дважды: {l.classroom} {key}"
                        classroom_slot[(l.classroom, key)] = t.teacher

    assert total == 3 + 3 + 3 + 3 + 2 + 2
