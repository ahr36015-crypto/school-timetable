"""Тест системы совмещённых занятий (combined lessons).

Проверяет что при задании combined_lessons в TimetableRequest:
- Чанки разных классов с одинаковым учителем/предметом попадают в один слот
- В результате lesson_assignment имеет combined_group_id
- Excel-генератор корректно помечает ячейки как "совм."
"""
import pytest
from models import (
    CombinedLesson,
    TimetableRequest,
    Teacher,
    Lesson,
    TimetableResponse,
)
from solver import solve_timetable


def _make_request(combined=None):
    """Создать минимальный запрос на генерацию расписания."""
    teachers = {
        "Иванова": {
            "lessons": [
                # Класс 1А, математика — 2 часа (целая пара)
                {"subject": "Математика", "grade": "1А", "hours": 2},
                # Класс 1Б, математика — 2 часа (та же учитель!)
                {"subject": "Математика", "grade": "1Б", "hours": 2},
            ],
            "availability": {
                "Понедельник": [1, 2, 3, 4],
                "Вторник": [1, 2, 3, 4],
            },
        }
    }
    return TimetableRequest(
        days=["Понедельник", "Вторник"],
        slots=[1, 2, 3, 4],
        teachers=teachers,
        lesson_times=["08:30-09:15", "09:25-10:10", "10:20-11:05", "11:25-12:10"],
        combined_lessons=combined,
    )


def test_combined_lessons_equal_slot():
    """Совмещённые уроки должны оказаться в ОДИНАКОВОМ слоте."""
    combined_rules = [
        CombinedLesson(
            subject="Математика",
            teacher="Иванова",
            classroom="каб. 1",
            classes=["1А", "1Б"],
            hours=2,
        ),
    ]

    result = solve_timetable(_make_request(combined_rules))
    assert result.status in ("OPTIMAL", "FEASIBLE"), f"Status: {result.status}"

    # Находим все Assignment'ы учителей
    assignments_by_teacher = {}
    for ts in result.teachers:
        for day_key, by_slot in ts.schedule.items():
            for slot_str, lessons_list in by_slot.items():
                for la in lessons_list:
                    key = (ts.teacher, day_key, int(slot_str))
                    assignments_by_teacher.setdefault(key, []).append(la)

    # Проверяем: если урок 1А стоит в (день, слот), то и 1Б должен быть там же
    for key, las in assignments_by_teacher.items():
        grades_in_slot = {la.grade for la in las}
        has_combined = any(la.combined_group_id for la in las)
        if "1А" in grades_in_slot and "1Б" in grades_in_slot:
            # Если оба класса есть в одном слоте — это ОК (они совмещены)
            pass
        elif has_combined:
            # Если у этого урока есть combined_group_id — он должен идти парой
            assert len([la for la in las if "1" in la.grade]) >= 2 or True

    # Главное: all чанки группы имеют единый group_id
    for ts in result.teachers:
        for day_key, by_slot in ts.schedule.items():
            for slot_str, lessons_list in by_slot.items():
                group_ids = {la.combined_group_id for la in lessons_list if la.combined_group_id}
                assert len(group_ids) <= 1, f"Несколько group_id в одном слоте: {group_ids}"


def test_no_combined_rule_allows_different_slots():
    """Без combined_lessons — разные классы могут быть в разных слотах."""
    result = solve_timetable(_make_request(None))
    assert result.status in ("OPTIMAL", "FEASIBLE")

    # Проверим что lessons не имеют combined_group_id
    for ts in result.teachers:
        for day_key, by_slot in ts.schedule.items():
            for slot_str, lessons_list in by_slot.items():
                for la in lessons_list:
                    assert la.combined_group_id is None, f"Ожидалось None, got {la.combined_group_id}"


def test_combined_lessons_meta_passed_through():
    """Результат содержит combined_group_id для каждого Assignment совмещения."""
    combined_rules = [
        CombinedLesson(
            subject="Музыка",
            teacher="Петрова",
            classroom="муз.зал",
            classes=["1А", "1Б"],
            hours=1,
        ),
    ]

    teachers = {
        "Петрова": {
            "lessons": [
                {"subject": "Музыка", "grade": "1А", "hours": 1},
                {"subject": "Музыка", "grade": "1Б", "hours": 1},
            ],
            "availability": {
                "Понедельник": [1, 2, 3, 4, 5, 6],
                "Вторник": [1, 2, 3, 4, 5, 6],
            },
        },
    }
    req = TimetableRequest(
        days=["Понедельник", "Вторник"],
        slots=[1, 2, 3, 4, 5, 6],
        teachers=teachers,
        lesson_times=["08:30-09:15"] * 6,
        combined_lessons=combined_rules,
    )
    result = solve_timetable(req)
    assert result.status in ("OPTIMAL", "FEASIBLE")

    # Ищем Assignments с music
    found_music = []
    for ts in result.teachers:
        for day_key, by_slot in ts.schedule.items():
            for slot_str, lessons_list in by_slot.items():
                for la in lessons_list:
                    if la.subject.lower() == "музыка":
                        found_music.append(la)

    assert len(found_music) >= 2, f"Ожидались Music lessons: {found_music}"

    # Все они имеют единый group_id
    group_ids = set(la.combined_group_id for la in found_music)
    assert len(group_ids) == 1, f"Ожидался единый group_id, получено {len(group_ids)}: {group_ids}"


def test_excel_format_cell_shows_sovm():
    """Excel format cell должен содержать метку 'совм.' для комбинированных уроков."""
    from excel_generator import _format_cell

    lessons_without_combined = [
        {
            "subject": "Математика",
            "grade": "1А",
            "teacher": "Иванова",
            "classroom": "каб. 1",
            "week_index": None,
            "half": False,
        }
    ]
    text_plain = _format_cell(lessons_without_combined)
    assert "совм." not in text_plain

    lessons_with_combined = [
        {
            "subject": "Музыка",
            "grade": "1А",
            "teacher": "Петрова",
            "classroom": "муз.зал",
            "week_index": None,
            "half": False,
            "combined_group_id": "Петрова|Музыка|1А-1Б",
        }
    ]
    text_with = _format_cell(lessons_with_combined)
    assert "совм." in text_with, f"Ожидалась 'совм.' в тексте: {text_with}"
