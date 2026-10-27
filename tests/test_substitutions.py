"""Тесты журнала замен (серверный, общий для всех пользователей)."""
import uuid


def _register(client):
    email = f"subs_{uuid.uuid4().hex}@test.ru"
    r = client.post("/register", json={
        "email": email, "password": "secret123",
        "full_name": "User " + email[:6], "school_name": "S",
    })
    assert r.status_code == 200, r.text
    return {"Authorization": "Bearer " + r.json()["access_token"]}


def test_substitution_crud_and_shared(client):
    user_a = _register(client)
    user_b = _register(client)

    # создаём замену от имени A
    r = client.post("/api/substitutions", headers=user_a, json={
        "date": "2026-10-27", "slot": 2, "grade": "5А",
        "absent": "Иванов И.И.", "substitute": "",
    })
    assert r.status_code == 200, r.text
    sub_id = r.json()["id"]
    assert r.json()["substitute"] == ""

    # пользователь B видит запись (журнал общий)
    listing = client.get("/api/substitutions", headers=user_b).json()
    assert any(s["id"] == sub_id for s in listing)

    # B назначает замену (редактирование чужой записи разрешено — журнал общий)
    r = client.patch(f"/api/substitutions/{sub_id}", headers=user_b, json={"substitute": "Петров С.П."})
    assert r.status_code == 200, r.text
    assert r.json()["substitute"] == "Петров С.П."

    # снятие замены
    r = client.patch(f"/api/substitutions/{sub_id}", headers=user_a, json={"substitute": ""})
    assert r.json()["substitute"] == ""

    # удаление
    r = client.delete(f"/api/substitutions/{sub_id}", headers=user_a)
    assert r.status_code == 200
    listing = client.get("/api/substitutions", headers=user_b).json()
    assert all(s["id"] != sub_id for s in listing)


def test_substitution_requires_auth(client):
    assert client.get("/api/substitutions").status_code in (401, 403)


def test_substitution_rejects_same_teacher(client):
    headers = _register(client)

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
