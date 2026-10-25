"""Сквозной тест сохранения тем уроков через HTTP + реальная БД."""


def test_update_topic_persists(client, auth_headers, sample_payload):
    r = client.post("/generate", json=sample_payload, headers=auth_headers)
    assert r.status_code == 200, r.text
    timetable_id = r.json()["id"]

    data = client.get(f"/timetables/{timetable_id}", headers=auth_headers).json()["data"]
    schedule = data["teachers"][0]["schedule"]
    day = next(iter(schedule))
    slot = next(iter(schedule[day]))
    lesson = schedule[day][slot][0]

    r = client.post(
        f"/timetables/{timetable_id}/update-topics",
        headers=auth_headers,
        json={"updates": [{
            "teacher": lesson["teacher"],
            "subject": lesson["subject"],
            "grade": lesson["grade"],
            "day": day,
            "slot": int(slot),
            "topic": "Дроби",
        }]},
    )
    assert r.status_code == 200, r.text
    assert r.json()["updated_count"] == 1

    data2 = client.get(f"/timetables/{timetable_id}", headers=auth_headers).json()["data"]
    topic = data2["teachers"][0]["schedule"][day][slot][0]["topic"]
    assert topic == "Дроби"
