"""Тесты журнала замен (изолированы по school_id)."""
import uuid


def _register(client, school_name="S"):
    email = f"subs_{uuid.uuid4().hex}@test.ru"
    r = client.post("/register", json={
        "email": email, "password": "secret123",
        "full_name": "User " + email[:6], "school_name": school_name,
    })
    assert r.status_code == 200, r.text
    return {"Authorization": "Bearer " + r.json()["access_token"]}


def test_substitution_crud_isolated_by_school(client):
    """Замены изолированы по школам — пользователь B не видит замены пользователя A."""
    user_a = _register(client, school_name="School A")
    user_b = _register(client, school_name="School B")

    # создаём замену от имени A
    r = client.post("/api/substitutions", headers=user_a, json={
        "date": "2026-10-27", "slot": 2, "grade": "5А",
        "absent": "Иванов И.И.", "substitute": "",
    })
    assert r.status_code == 200, r.text
    sub_id = r.json()["id"]
    assert r.json()["substitute"] == ""

    # пользователь B НЕ видит запись A (изоляцию по школе)
    listing = client.get("/api/substitutions", headers=user_b).json()
    assert not any(s["id"] == sub_id for s in listing), "Замена пользователя A не должна быть видна пользователю B"

    # пользователь A видит свою запись
    listing_a = client.get("/api/substitutions", headers=user_a).json()
    assert any(s["id"] == sub_id for s in listing_a)

    # пользователь B не может редактировать замену A
    r = client.patch(f"/api/substitutions/{sub_id}", headers=user_b, json={"substitute": "Петров С.П."})
    assert r.status_code == 404, "Пользователь B не должен иметь доступа к замене пользователя A"

    # пользователь A может редактировать свою замену
    r = client.patch(f"/api/substitutions/{sub_id}", headers=user_a, json={"substitute": "Петров С.П."})
    assert r.status_code == 200, r.text
    assert r.json()["substitute"] == "Петров С.П."

    # удаление
    r = client.delete(f"/api/substitutions/{sub_id}", headers=user_a)
    assert r.status_code == 200
    listing_a = client.get("/api/substitutions", headers=user_a).json()
    assert all(s["id"] != sub_id for s in listing_a)


def test_substitution_requires_auth(client):
    assert client.get("/api/substitutions").status_code in (401, 403)


def test_substitution_rejects_same_teacher(client):
    headers = _register(client, school_name="Test School")

    # POST: замена совпадает с отсутствующим
    r = client.post("/api/substitutions", headers=headers, json={
        "absent": "Иванов И.И.", "substitute": "Иванов И.И.", "slot": 1, "grade": "5А",
    })
    assert r.status_code == 400, r.text

    # создаём корректную запись, затем PATCH на того же учителя
    r = client.post("/api/substitutions", headers=headers, json={
        "absent": "Иванов И.И.", "substitute": "", "slot": 1, "grade": "5А",
    })
    assert r.status_code == 200, r.text
    sub_id = r.json()["id"]

    r = client.patch(f"/api/substitutions/{sub_id}", headers=headers, json={"substitute": "Иванов И.И."})
    assert r.status_code == 400, r.text

    client.delete(f"/api/substitutions/{sub_id}", headers=headers)
