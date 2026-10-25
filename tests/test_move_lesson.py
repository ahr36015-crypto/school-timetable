"""Сквозной тест переноса урока (drag-and-drop) через HTTP + реальная БД."""
import pytest


def _first_lesson(schedule):
    day = next(iter(schedule))
    slot = int(next(iter(schedule[day])))
    return day, slot, schedule[day][str(slot)][0]


def _empty_slot(data, schedule, src_day, src_slot):
    for day in data["days"]:
        for slot in data["slots"]:
            if schedule.get(day, {}).get(str(slot)):
                continue
            if day == src_day and slot == src_slot:
                continue
            return day, slot
    return None


def test_move_lesson_persists(client, auth_headers, sample_payload):
    r = client.post("/generate", json=sample_payload, headers=auth_headers)
    assert r.status_code == 200, r.text
    timetable_id = r.json().get("id")
    assert timetable_id, r.text

    data = client.get(f"/timetables/{timetable_id}", headers=auth_headers).json()["data"]
    schedule = data["teachers"][0]["schedule"]
    src_day, src_slot, lesson = _first_lesson(schedule)

    dst = _empty_slot(data, schedule, src_day, src_slot)
    assert dst, "нет свободного слота для переноса"
    dst_day, dst_slot = dst

    move = {
        "teacher": lesson["teacher"],
        "subject": lesson["subject"],
        "grade": lesson["grade"],
        "classroom": lesson.get("classroom", ""),
        "from_day": src_day,
        "from_slot": src_slot,
        "to_day": dst_day,
        "to_slot": dst_slot,
    }
    r = client.post(f"/timetables/{timetable_id}/move-lesson", json=move, headers=auth_headers)
    assert r.status_code == 200, r.text

    # читаем заново из БД — это ловит баг с неперсистентной мутацией JSON
    data2 = client.get(f"/timetables/{timetable_id}", headers=auth_headers).json()["data"]
    schedule2 = data2["teachers"][0]["schedule"]

    assert not schedule2.get(src_day, {}).get(str(src_slot)), "урок остался на старом месте"
    assert any(l["grade"] == lesson["grade"] for l in schedule2.get(dst_day, {}).get(str(dst_slot), [])), \
        "урок не появился в новом месте"

    total = sum(len(v) for day in schedule2.values() for v in day.values())
    assert total == 2, f"дубликаты после переноса: всего уроков {total}"
