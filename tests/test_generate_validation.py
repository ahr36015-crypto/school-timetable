"""Регрессия: пустые/None часы не должны вызывать 422 при генерации."""


def test_lesson_hours_coercion():
    from models import Lesson

    assert Lesson(subject="Математика", grade="5А", hours=None).hours == 1
    assert Lesson(subject="Математика", grade="5А", hours="").hours == 1
    assert Lesson(subject="Математика", grade="5А", hours=0).hours == 1
    assert Lesson(subject="Математика", grade="5А", hours=-3).hours == 1
    assert Lesson(subject="Математика", grade="5А", hours="3").hours == 3
    # отсутствующие/None subject/grade не ломают валидацию
    assert Lesson(subject=None, grade=None, hours=2).subject == ""
    assert Lesson(subject=None, grade=None, hours=2).grade == ""


def test_generate_accepts_null_and_empty_hours(client, auth_headers):
    payload = {
        "days": ["Понедельник", "Вторник"],
        "slots": [1, 2, 3],
        "lessonTimes": ["08:30-09:15", "09:25-10:10", "10:20-11:05"],
        "teachers": {
            "Иванов И.И.": {
                "lessons": [
                    {"subject": "Математика", "grade": "5А", "hours": None, "classroom": "101"},
                    {"subject": "Математика", "grade": "5А", "hours": "", "classroom": "101"},
                ],
                "availability": {"Понедельник": [1, 2, 3], "Вторник": [1, 2, 3]},
            }
        },
    }
    r = client.post("/generate", json=payload, headers=auth_headers)
    assert r.status_code == 200, r.text
    assert r.json().get("id")
