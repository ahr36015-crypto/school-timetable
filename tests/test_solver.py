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


def test_solver_infeasible_reports_reason():
    request = TimetableRequest(
        days=["Понедельник"],
        slots=[1],
        teachers={
            "А": Teacher(
                lessons=[Lesson(subject="Математика", grade="5А", hours=2)],
                availability={"Понедельник": [1]},
            )
        },
    )
    result = solve_timetable(request)
    assert result.status == "INFEASIBLE"
    # сообщение должно содержать конкретную причину, а не только общую фразу
    assert any("Класс 5А" in e for e in result.validation_errors)


def test_parity_lessons_can_share_slot():
    # 5А: Физика только в синюю неделю и Химия только в красную — могут стоять
    # в один и тот же слот (в одну неделю бывает только одна из них).
    request = TimetableRequest(
        days=["Понедельник"], slots=[1],
        teachers={
            "T1": Teacher(lessons=[Lesson(subject="Физика", grade="5А", hours=1, weekIndex=0)],
                          availability={"Понедельник": [1]}),
            "T2": Teacher(lessons=[Lesson(subject="Химия", grade="5А", hours=1, weekIndex=1)],
                          availability={"Понедельник": [1]}),
        },
    )
    result = solve_timetable(request)
    assert result.status in ("OPTIMAL", "FEASIBLE"), result.validation_errors
    placed = []
    for t in result.teachers:
        for slots in t.schedule.values():
            for lessons in slots.values():
                placed.extend(lessons)
    assert len(placed) == 2
    assert {l.week_index for l in placed} == {0, 1}


def test_everyweek_lessons_conflict_in_same_slot():
    # Без чётности два урока одного класса в одном слоте невозможны
    request = TimetableRequest(
        days=["Понедельник"], slots=[1],
        teachers={
            "T1": Teacher(lessons=[Lesson(subject="Физика", grade="5А", hours=1)],
                          availability={"Понедельник": [1]}),
            "T2": Teacher(lessons=[Lesson(subject="Химия", grade="5А", hours=1)],
                          availability={"Понедельник": [1]}),
        },
    )
    result = solve_timetable(request)
    assert result.status == "INFEASIBLE"


def test_two_half_lessons_share_slot():
    # Две «половинки» одного класса помещаются в один слот (0.5 + 0.5 = 1)
    request = TimetableRequest(
        days=["Понедельник"], slots=[1],
        teachers={
            "T1": Teacher(lessons=[Lesson(subject="Ритмика", grade="5А", hours=0.5)],
                          availability={"Понедельник": [1]}),
            "T2": Teacher(lessons=[Lesson(subject="Музыка", grade="5А", hours=0.5)],
                          availability={"Понедельник": [1]}),
        },
    )
    result = solve_timetable(request)
    assert result.status in ("OPTIMAL", "FEASIBLE"), result.validation_errors
    placed = [l for t in result.teachers for slots in t.schedule.values()
              for lessons in slots.values() for l in lessons]
    assert len(placed) == 2
    assert all(l.half for l in placed)


def test_full_and_half_conflict_in_slot():
    # Полная (1) + половинка (0.5) в одном слоте невозможны
    request = TimetableRequest(
        days=["Понедельник"], slots=[1],
        teachers={
            "T1": Teacher(lessons=[Lesson(subject="Математика", grade="5А", hours=1)],
                          availability={"Понедельник": [1]}),
            "T2": Teacher(lessons=[Lesson(subject="Музыка", grade="5А", hours=0.5)],
                          availability={"Понедельник": [1]}),
        },
    )
    result = solve_timetable(request)
    assert result.status == "INFEASIBLE"


def test_no_gaps_in_class_day():
    # 2 часа при 3 слотах должны встать компактно с первого урока (1,2), без дыры
    request = TimetableRequest(
        days=["Понедельник"], slots=[1, 2, 3],
        teachers={
            "T1": Teacher(lessons=[Lesson(subject="Математика", grade="5А", hours=2)],
                          availability={"Понедельник": [1, 2, 3]}),
        },
    )
    result = solve_timetable(request)
    assert result.status in ("OPTIMAL", "FEASIBLE"), result.validation_errors
    used = set()
    for t in result.teachers:
        for by_slot in t.schedule.values():
            used.update(int(s) for s in by_slot.keys())
    assert used == {1, 2}, f"ожидались слоты 1,2 без разрыва, получено {used}"


def test_no_gaps_for_teacher():
    # У учителя 4 часа в 5 слотах — должны идти подряд с первого урока
    request = TimetableRequest(
        days=["Понедельник"], slots=[1, 2, 3, 4, 5],
        teachers={
            "T": Teacher(
                lessons=[
                    Lesson(subject="Математика", grade="5А", hours=2),
                    Lesson(subject="Физика", grade="6Б", hours=2),
                ],
                availability={"Понедельник": [1, 2, 3, 4, 5]},
            ),
        },
    )
    result = solve_timetable(request)
    assert result.status in ("OPTIMAL", "FEASIBLE"), result.validation_errors
    used = set()
    for by_slot in result.teachers[0].schedule.values():
        used.update(int(s) for s in by_slot.keys())
    assert used == {1, 2, 3, 4}, f"у учителя разрыв в расписании: {used}"


def test_lessons_packed_to_earliest_day_and_slots():
    # 3 часа при 5 днях x 5 слотах — должны уплотниться в первый день, слоты 1,2,3
    days = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница"]
    request = TimetableRequest(
        days=days, slots=[1, 2, 3, 4, 5],
        teachers={
            "T": Teacher(lessons=[Lesson(subject="Математика", grade="5А", hours=3)],
                         availability={d: [1, 2, 3, 4, 5] for d in days}),
        },
    )
    result = solve_timetable(request)
    assert result.status in ("OPTIMAL", "FEASIBLE"), result.validation_errors
    schedule = result.teachers[0].schedule
    assert list(schedule.keys()) == ["Понедельник"], f"ожидался один день, получено {list(schedule.keys())}"
    used = sorted(int(s) for s in schedule["Понедельник"].keys())
    assert used == [1, 2, 3], f"ожидались слоты 1,2,3, получено {used}"
